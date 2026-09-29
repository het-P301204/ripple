"""Background scan jobs.

Each job runs ``engine.run_scan`` on its own event loop in a worker thread (the engine's typosquat
generation is CPU-heavy; a dedicated thread keeps the API responsive for the UI's ~300 ms polling).
The engine's real progress callback is mapped 1:1 onto ``JobStatus`` - there are no timers or fake stages.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

from ripple.config import cache_dir
from ripple.models import STAGES, JobStatus, ProgressStage, ScanOptions, ScanSource

from . import store
from .errors import INTERNAL, UNSUPPORTED, RippleUserError, classify, SUPPORTED_HINT

log = logging.getLogger("ripple.server.jobs")

_ACTIVE = {"active", "start", "started", "running", "in_progress", "in-progress", "begin"}
_DONE = {"done", "complete", "completed", "finish", "finished", "ok", "success"}
_ERROR = {"error", "failed", "fail"}
_SKIPPED = {"skipped", "skip"}


def _norm(state: str) -> str:
    s = (state or "").lower()
    if s in _ACTIVE:
        return "active"
    if s in _DONE:
        return "done"
    if s in _ERROR:
        return "error"
    if s in _SKIPPED:
        return "skipped"
    return "pending"


def _as_dict(info) -> dict:
    if isinstance(info, dict):
        return info
    if hasattr(info, "model_dump"):
        return info.model_dump()
    return dict(vars(info))


@dataclass
class _Job:
    status: JobStatus
    created: float = field(default_factory=time.time)
    finished: Optional[float] = None
    active_fraction: float = 0.0


class JobQueueFull(Exception):
    """Too many scans are queued/running; the caller should answer 429."""


class JobManager:
    def __init__(self, max_concurrent: int = 2, retention_s: float = 3600.0, max_jobs: int = 200,
                 max_pending: int = 8, keep_scans: int = 500):
        self.max_pending = max_pending      # unfinished jobs (each holds its whole upload in memory + a thread)
        self.keep_scans = keep_scans        # stored scans kept on disk by server-created jobs (oldest pruned)
        self._jobs: dict[str, _Job] = {}
        self._lock = threading.RLock()
        self._sem = threading.BoundedSemaphore(max_concurrent)
        self.retention_s = retention_s
        self.max_jobs = max_jobs

    # -- public API ----------------------------------------------------------------------------------
    def submit(self, inputs: list, options: ScanOptions, project: Optional[str] = None,
               source: Optional[ScanSource] = None) -> str:
        job_id = uuid.uuid4().hex[:12]
        status = JobStatus(job_id=job_id, status="queued", progress=0.0,
                           stages=[ProgressStage(id=sid, label=label) for sid, label in STAGES])
        with self._lock:
            self._prune()
            if sum(1 for j in self._jobs.values() if j.finished is None) >= self.max_pending:
                raise JobQueueFull()
            self._jobs[job_id] = _Job(status=status)
        t = threading.Thread(target=self._worker, args=(job_id, inputs, options, project, source),
                             name=f"ripple-job-{job_id}", daemon=True)
        t.start()
        return job_id

    def get(self, job_id: str) -> Optional[JobStatus]:
        with self._lock:
            self._prune()
            job = self._jobs.get(job_id)
            return job.status.model_copy(deep=True) if job else None

    def wait(self, job_id: str, timeout: float = 30.0) -> Optional[JobStatus]:
        """Block until the job finishes (used by tests / synchronous callers)."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            st = self.get(job_id)
            if st is None or st.status in ("done", "error"):
                return st
            time.sleep(0.02)
        return self.get(job_id)

    # -- internals -------------------------------------------------------------------------------------
    def _prune(self) -> None:
        now = time.time()
        for jid in [j for j, job in self._jobs.items()
                    if job.finished is not None and now - job.finished > self.retention_s]:
            self._jobs.pop(jid, None)
        if len(self._jobs) > self.max_jobs:
            done = sorted((j for j, job in self._jobs.items() if job.finished is not None),
                          key=lambda j: self._jobs[j].finished or 0)
            for jid in done[: len(self._jobs) - self.max_jobs]:
                self._jobs.pop(jid, None)

    def _progress_value(self, job: _Job) -> float:
        total = len(job.status.stages) or 1
        done = sum(1 for s in job.status.stages if s.state in ("done", "skipped"))
        active = any(s.state == "active" for s in job.status.stages)
        return min(1.0, (done + (job.active_fraction if active else 0.0)) / total)

    def _callback(self, job_id: str):
        def cb(stage_id: str, state: str, detail: str = "", fraction: Optional[float] = None) -> None:
            with self._lock:
                job = self._jobs.get(job_id)
                if job is None:
                    return
                st = _norm(state)
                for stage in job.status.stages:
                    if stage.id == stage_id:
                        stage.state = st
                        if detail:
                            stage.detail = str(detail)[:200]
                        break
                if st == "active" and fraction is not None:
                    job.active_fraction = max(0.0, min(1.0, float(fraction)))
                elif st != "active":
                    job.active_fraction = 0.0
                if st == "error":
                    return
                job.status.progress = max(job.status.progress, min(0.99, self._progress_value(job)))
        return cb

    def _finish(self, job_id: str, **updates) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            for k, v in updates.items():
                setattr(job.status, k, v)
            job.finished = time.time()

    def _worker(self, job_id: str, inputs: list, options: ScanOptions, project: Optional[str],
                source: Optional[ScanSource]) -> None:
        with self._sem:
            with self._lock:
                job = self._jobs.get(job_id)
                if job is None:
                    return
                job.status.status = "running"
            try:
                from ripple.engine import detect, run_scan  # engine-owned, imported lazily

                usable, skipped = [], []
                for inp in inputs:
                    try:
                        info = _as_dict(detect(inp.filename, inp.content))
                    except Exception:  # detection failure == unsupported for our purposes
                        info = {"supported": False}
                    (usable if info.get("supported") else skipped).append(inp)
                if not usable:
                    names = ", ".join(i.filename for i in skipped) or "the uploaded files"
                    raise RippleUserError(f"Unsupported lockfile: {names}. {SUPPORTED_HINT}", UNSUPPORTED)

                result = asyncio.run(run_scan(usable, options, project=project, progress=self._callback(job_id),
                                              source=source,
                                              cache_dir=str(cache_dir()) if options.live else None))
                if skipped:
                    result.warnings.append("Skipped unsupported file(s): " + ", ".join(i.filename for i in skipped))
                result = store.save(result, keep=self.keep_scans)
                with self._lock:
                    j = self._jobs.get(job_id)
                    if j is not None:
                        for stage in j.status.stages:
                            if stage.state in ("pending", "active"):
                                stage.state = "skipped" if stage.state == "pending" else "done"
                self._finish(job_id, status="done", progress=1.0, scan_id=result.id)
            except BaseException as exc:  # noqa: BLE001 - job boundary: never let a thread die silently
                code, message = classify(exc)
                if code == INTERNAL:
                    log.exception("scan job %s failed", job_id)
                else:
                    log.info("scan job %s failed: %s (%s)", job_id, code, type(exc).__name__)
                with self._lock:
                    j = self._jobs.get(job_id)
                    if j is not None:
                        for stage in j.status.stages:
                            if stage.state == "active":
                                stage.state = "error"
                self._finish(job_id, status="error", error=message, error_code=code)
