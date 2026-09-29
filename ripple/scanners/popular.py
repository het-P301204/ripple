"""Embedded lists of widely used packages per ecosystem (used as typosquat reference targets).

Ordered roughly by popularity. Only public, well-known project names appear here.
"""
from __future__ import annotations

from ..models import Ecosystem
from ..parsers.normalize import comparison_key

_NPM = """
lodash react react-dom express axios chalk commander debug moment typescript webpack babel-loader tslib
uuid async request underscore bluebird fs-extra glob minimist yargs semver mkdirp rimraf inquirer dotenv
body-parser cors jsonwebtoken bcrypt bcryptjs passport mongoose mysql pg redis ioredis socket.io ws
cheerio jquery vue vuex vue-router angular rxjs zone.js core-js regenerator-runtime prop-types classnames
next nuxt gatsby svelte preact redux react-redux react-router react-router-dom redux-thunk redux-saga
styled-components emotion tailwindcss postcss autoprefixer sass less node-sass sass-loader css-loader
style-loader file-loader url-loader html-webpack-plugin webpack-cli webpack-dev-server rollup vite esbuild
parcel gulp grunt eslint prettier jest mocha chai sinon karma jasmine cypress puppeteer playwright
nodemon ts-node ts-jest supertest enzyme husky lint-staged commitlint standard-version lerna nx turbo
winston pino morgan bunyan log4js cookie-parser express-session helmet compression multer formidable
nodemailer handlebars ejs pug mustache marked highlight.js prismjs showdown markdown-it js-yaml yaml
xml2js fast-xml-parser papaparse csv-parser csv-parse exceljs xlsx pdfkit sharp jimp gm imagemagick
aws-sdk firebase firebase-admin googleapis stripe twilio sendgrid mailgun-js
graphql apollo-server apollo-client graphql-tag type-graphql prisma sequelize typeorm knex bookshelf
mongodb sqlite3 better-sqlite3 lowdb nedb leveldown level immutable ramda date-fns dayjs luxon
validator joi yup ajv zod class-validator class-transformer reflect-metadata inversify tsyringe
cross-env cross-spawn execa shelljs which chokidar fsevents node-fetch isomorphic-fetch got superagent
form-data qs querystring query-string url-parse whatwg-url iconv-lite safe-buffer buffer readable-stream
through2 concat-stream pump event-stream stream-browserify inherits util process path-browserify os-browserify
crypto-js crypto-browserify bn.js elliptic hash.js md5 sha.js tweetnacl uglify-js terser clean-css
mime mime-types mime-db content-type accepts negotiator statuses http-errors depd ms on-finished
@babel/core @babel/preset-env @babel/preset-react @babel/runtime @babel/cli @babel/parser @babel/traverse
@types/node @types/react @types/express @types/lodash @types/jest @types/react-dom
@angular/core @angular/common @angular/cli @angular/router @angular/forms @nestjs/core @nestjs/common
@aws-sdk/client-s3 @aws-sdk/client-dynamodb @mui/material @emotion/react @emotion/styled @reduxjs/toolkit
@testing-library/react @testing-library/jest-dom @typescript-eslint/parser @typescript-eslint/eslint-plugin
@grpc/grpc-js @sentry/node @sentry/browser @apollo/client @prisma/client @vue/cli-service
""".split()

_PYPI = """
requests urllib3 boto3 botocore setuptools pip wheel certifi idna charset-normalizer six python-dateutil pytz
numpy pandas scipy matplotlib seaborn scikit-learn tensorflow torch keras pillow opencv-python sympy statsmodels
jinja2 markupsafe flask django fastapi starlette uvicorn gunicorn werkzeug click itsdangerous pydantic
sqlalchemy alembic psycopg2 psycopg2-binary pymysql mysqlclient redis celery kombu amqp pymongo motor
pytest pytest-cov pytest-mock pytest-asyncio tox coverage mock nose flake8 pylint black isort mypy bandit
pyyaml toml tomli ujson orjson simplejson attrs cffi pycparser cryptography pyopenssl pyjwt bcrypt paramiko
httpx aiohttp yarl multidict frozenlist aiosignal async-timeout websockets grpcio protobuf googleapis-common-protos
google-api-core google-auth google-cloud-storage google-cloud-bigquery azure-core azure-storage-blob msal
docutils sphinx pygments babel packaging pyparsing typing-extensions importlib-metadata zipp more-itertools
colorama tqdm rich typer tabulate termcolor prompt-toolkit wcwidth decorator wrapt cachetools filelock platformdirs
virtualenv distlib pipenv poetry pluggy iniconfig exceptiongroup tomlkit lxml beautifulsoup4 soupsieve html5lib
scrapy selenium playwright pyzmq tornado twisted zope-interface gevent greenlet eventlet
pexpect ptyprocess psutil pywin32 pyserial regex jsonschema jmespath s3transfer awscli aws-sdk
openpyxl xlrd xlsxwriter python-docx reportlab pypdf pypdf2 fpdf markdown mistune
networkx nltk spacy gensim transformers tokenizers huggingface-hub datasets accelerate safetensors
joblib threadpoolctl numba llvmlite cython pybind11 h5py tables pyarrow fastparquet dask
faker factory-boy hypothesis freezegun responses moto docker kubernetes fabric invoke
python-dotenv environs marshmallow cerberus voluptuous jsonpatch jsonpointer
peewee tortoise-orm asyncpg aiomysql aiosqlite databases sqlmodel
gitpython pygithub jira slack-sdk twilio stripe sentry-sdk structlog loguru
""".split()

_GO = """
github.com/gin-gonic/gin github.com/gorilla/mux github.com/stretchr/testify github.com/sirupsen/logrus
github.com/spf13/cobra github.com/spf13/viper github.com/spf13/pflag github.com/spf13/afero
github.com/pkg/errors github.com/google/uuid github.com/go-sql-driver/mysql github.com/lib/pq
github.com/jackc/pgx github.com/jmoiron/sqlx github.com/go-redis/redis github.com/redis/go-redis
github.com/gorilla/websocket github.com/gorilla/handlers github.com/gorilla/sessions github.com/gorilla/schema
github.com/labstack/echo github.com/gofiber/fiber github.com/go-chi/chi github.com/julienschmidt/httprouter
github.com/dgrijalva/jwt-go github.com/golang-jwt/jwt github.com/go-playground/validator github.com/mitchellh/mapstructure
github.com/prometheus/client_golang github.com/prometheus/common github.com/prometheus/procfs
github.com/grpc-ecosystem/grpc-gateway github.com/golang/protobuf github.com/golang/glog github.com/golang/mock
github.com/aws/aws-sdk-go github.com/aws/aws-sdk-go-v2 github.com/Azure/azure-sdk-for-go
github.com/hashicorp/consul github.com/hashicorp/vault github.com/hashicorp/terraform github.com/hashicorp/go-multierror
github.com/hashicorp/go-version github.com/hashicorp/hcl github.com/hashicorp/golang-lru
github.com/docker/docker github.com/docker/distribution github.com/containerd/containerd github.com/opencontainers/runc
github.com/coreos/etcd github.com/etcd-io/etcd github.com/fsnotify/fsnotify github.com/kr/pretty github.com/davecgh/go-spew
github.com/pmezard/go-difflib github.com/stretchr/objx github.com/onsi/ginkgo github.com/onsi/gomega
github.com/rs/zerolog github.com/uber-go/zap github.com/gin-contrib/cors github.com/swaggo/swag
github.com/urfave/cli github.com/fatih/color github.com/mattn/go-sqlite3 github.com/mattn/go-isatty
github.com/olekukonko/tablewriter github.com/cheggaaa/pb github.com/briandowns/spinner github.com/manifoldco/promptui
github.com/gocolly/colly github.com/PuerkitoBio/goquery github.com/andybalholm/cascadia
github.com/json-iterator/go github.com/modern-go/reflect2 github.com/modern-go/concurrent github.com/ugorji/go
github.com/segmentio/kafka-go github.com/Shopify/sarama github.com/IBM/sarama github.com/nats-io/nats.go
github.com/streadway/amqp github.com/rabbitmq/amqp091-go github.com/go-kit/kit github.com/go-logr/logr
github.com/robfig/cron github.com/go-co-op/gocron github.com/patrickmn/go-cache github.com/allegro/bigcache
github.com/dgraph-io/badger github.com/boltdb/bolt github.com/etcd-io/bbolt github.com/syndtr/goleveldb
github.com/minio/minio-go github.com/aliyun/aliyun-oss-go-sdk github.com/stripe/stripe-go github.com/slack-go/slack
github.com/google/go-cmp github.com/google/go-github github.com/google/gopacket github.com/google/btree
github.com/gogo/protobuf github.com/cespare/xxhash github.com/beorn7/perks github.com/matttproud/golang_protobuf_extensions
github.com/pelletier/go-toml github.com/BurntSushi/toml github.com/magiconair/properties github.com/subosito/gotenv
github.com/joho/godotenv github.com/kelseyhightower/envconfig github.com/caarlos0/env
github.com/xdg-go/scram github.com/klauspost/compress github.com/pierrec/lz4 github.com/golang/snappy
github.com/inconshreveable/mousetrap github.com/russross/blackfriday github.com/yuin/goldmark github.com/microcosm-cc/bluemonday
github.com/nfnt/resize github.com/disintegration/imaging github.com/gen2brain/beeep
golang.org/x/net golang.org/x/sys golang.org/x/text golang.org/x/crypto golang.org/x/sync golang.org/x/tools
golang.org/x/oauth2 golang.org/x/time golang.org/x/mod golang.org/x/term golang.org/x/exp golang.org/x/image
google.golang.org/grpc google.golang.org/protobuf google.golang.org/api google.golang.org/genproto
gopkg.in/yaml.v2 gopkg.in/yaml.v3 gopkg.in/check.v1 gopkg.in/natefinch/lumberjack.v2
k8s.io/client-go k8s.io/api k8s.io/apimachinery k8s.io/klog sigs.k8s.io/yaml sigs.k8s.io/controller-runtime
go.uber.org/zap go.uber.org/multierr go.uber.org/atomic go.etcd.io/etcd go.opentelemetry.io/otel
cloud.google.com/go go.mongodb.org/mongo-driver honnef.co/go/tools
""".split()

_RUST = """
serde serde_json serde_derive serde_yaml tokio tokio-util futures futures-util async-trait async-std
rand rand_core rand_chacha libc log env_logger tracing tracing-subscriber tracing-core anyhow thiserror
clap clap_derive structopt regex regex-syntax aho-corasick memchr lazy_static once_cell bytes
hyper reqwest http http-body tower tower-service axum actix-web actix-rt warp rocket tonic prost
openssl openssl-sys native-tls rustls ring sha2 sha1 md5 hex base64 digest crypto-mac hmac aes
chrono time uuid url percent-encoding idna itertools rayon crossbeam crossbeam-utils parking_lot
syn quote proc-macro2 unicode-ident unicode-xid cfg-if autocfg bitflags byteorder smallvec arrayvec
indexmap hashbrown either num-traits num-integer num-bigint num_cpus semver toml toml_edit
diesel sqlx rusqlite postgres redis mongodb sea-orm r2d2 deadpool
mio socket2 nix winapi windows-sys getrandom fastrand tempfile walkdir glob fs_extra
termcolor colored ansi_term atty dirs dirs-next home shellexpand which
csv flate2 zip tar bzip2 brotli zstd lz4 snap miniz_oxide adler crc32fast
image png jpeg-decoder gif lodepng
nom pest combine logos lalrpop
scopeguard lock_api spin static_assertions maplit matches
tempdir criterion proptest quickcheck mockall assert_cmd predicates pretty_assertions
wasm-bindgen js-sys web-sys wasm-bindgen-futures console_error_panic_hook
ctrlc signal-hook crossterm tui ratatui indicatif console dialoguer
bincode ron rmp-serde prost-types protobuf
derive_more strum strum_macros paste ahash fxhash seahash siphasher
pin-project pin-project-lite futures-core futures-channel futures-io futures-sink futures-task
""".split()

POPULAR: dict[Ecosystem, list[str]] = {
    Ecosystem.NPM: list(dict.fromkeys(_NPM)),
    Ecosystem.PYPI: list(dict.fromkeys(_PYPI)),
    Ecosystem.GO: list(dict.fromkeys(_GO)),
    Ecosystem.RUST: list(dict.fromkeys(_RUST)),
}

# Legitimately distinct pairs that sit within a small edit distance of each other.
_ALLOW_PAIRS = [
    ("chalk", "chai"), ("debug", "debug"), ("mocha", "moca"), ("jest", "just"), ("express", "expres"),
    ("react", "preact"), ("vue", "vue2"), ("lodash", "lodash-es"), ("moment", "moment-timezone"),
    ("request", "requests"), ("colors", "color"), ("glob", "globby"), ("ws", "wss"), ("pg", "pug"),
    ("sass", "less"), ("mime", "mime-db"), ("uuid", "uuid4"), ("jest", "jsdom"),
    ("numpy", "numba"), ("pandas", "pandas-stubs"), ("flask", "flask-cors"), ("black", "blake"),
    ("mock", "moto"), ("six", "sixs"), ("nose", "nose2"), ("toml", "tomli"), ("attrs", "attr"),
    ("rand", "rank"), ("time", "tide"), ("hex", "hexx"), ("log", "lop"), ("syn", "sys"), ("nom", "nam"),
    ("serde", "serde_json"), ("tokio", "tokei"), ("mio", "mia"), ("url", "uri"), ("csv", "cbv"),
    ("jinja2", "jinja"), ("psycopg2", "psycopg"), ("click", "clicks"), ("pytest", "pytest-cov"),
    # distinct, long-established projects that real lockfiles contain next to their look-alike neighbour
    ("xml-js", "xml2js"), ("cattrs", "attrs"), ("adler2", "adler"), ("fpdf2", "fpdf"), ("matchers", "matches"),
    ("httpx", "httpx2"), ("ts-loader", "css-loader"), ("ts-loader", "url-loader"), ("ts-loader", "sass-loader"),
    ("safer-buffer", "safe-buffer"), ("ttypescript", "typescript"), ("leven", "level"), ("tslint", "eslint"),
    ("commondir", "commander"), ("motion", "emotion"), ("preact", "react"), ("vitest", "jest"),
]
ALLOWLIST: set[frozenset[str]] = {frozenset((a, b)) for a, b in _ALLOW_PAIRS}

_KEYS: dict[Ecosystem, dict[str, str]] = {}


def popular_keys(ecosystem: Ecosystem) -> dict[str, str]:
    """comparison_key -> canonical popular name."""
    if ecosystem not in _KEYS:
        _KEYS[ecosystem] = {comparison_key(ecosystem, n): n for n in POPULAR[ecosystem]}
    return _KEYS[ecosystem]


def popularity_rank(ecosystem: Ecosystem, name: str) -> int | None:
    """0 = most popular; None if not in the embedded list."""
    key = comparison_key(ecosystem, name)
    for i, n in enumerate(POPULAR[ecosystem]):
        if comparison_key(ecosystem, n) == key:
            return i
    return None


def is_popular(ecosystem: Ecosystem, name: str) -> bool:
    return comparison_key(ecosystem, name) in popular_keys(ecosystem)


def is_allowlisted(a: str, b: str) -> bool:
    return frozenset((a.lower(), b.lower())) in ALLOWLIST


# npm scopes owned by well-known public organisations (never treated as "internal-looking").
PUBLIC_NPM_SCOPES = {
    "@types", "@babel", "@angular", "@nestjs", "@aws-sdk", "@aws-cdk", "@mui", "@emotion", "@reduxjs",
    "@testing-library", "@typescript-eslint", "@sentry", "@grpc", "@apollo", "@prisma", "@vue", "@nx",
    "@storybook", "@octokit", "@smithy", "@azure", "@google-cloud", "@firebase", "@stripe", "@vitejs",
    "@rollup", "@swc", "@jest", "@eslint", "@webpack", "@fortawesome", "@popperjs", "@radix-ui",
    "@tanstack", "@trpc", "@graphql-tools", "@opentelemetry", "@sinonjs", "@humanwhocodes", "@nodelib",
    "@svgr", "@tailwindcss", "@ant-design", "@ethersproject", "@solana", "@lezer", "@codemirror",
    "@vitest", "@floating-ui", "@reactflow", "@xyflow", "@jridgewell", "@isaacs", "@esbuild", "@rolldown", "@napi-rs",
    "@emnapi", "@tybys", "@inquirer", "@lit", "@csstools", "@pkgr", "@vueuse", "@headlessui", "@heroicons", "@dnd-kit",
    "@next", "@parcel", "@playwright", "@sveltejs", "@remix-run", "@formatjs", "@date-io", "@sindresorhus", "@tsconfig",
    "@cspotcode", "@mdx-js", "@hapi", "@nrwl", "@oclif", "@sinclair", "@ungap", "@webassemblyjs", "@xtuc", "@ctrl",
    "@colors", "@gar", "@npmcli", "@tootallnate", "@protobufjs", "@react-aria", "@react-stately", "@react-spectrum",
    "@chakra-ui", "@mantine", "@nuxt", "@ionic", "@stencil", "@uiw", "@bcoe", "@istanbuljs", "@ampproject", "@sideway",
    "@szmarczak", "@rushstack", "@standard-schema", "@eslint-community", "@humanfs", "@pkgjs", "@modelcontextprotocol",
    "@lexical", "@hono", "@preact", "@epic-web", "@oxc-project", "@microsoft", "@mapbox", "@nx", "@turf", "@vercel",
    "@radix-ui", "@react-three", "@use-gesture", "@tiptap", "@prosemirror", "@fastify", "@koa", "@hookform",
}

# Hosts that publish public Go modules / crates sources.
PUBLIC_GO_HOSTS = {
    "github.com", "gitlab.com", "bitbucket.org", "golang.org", "google.golang.org", "gopkg.in", "go.uber.org",
    "k8s.io", "sigs.k8s.io", "cloud.google.com", "go.opentelemetry.io", "honnef.co", "go.etcd.io",
    "go.mongodb.org", "gocloud.dev", "go.temporal.io", "go.opencensus.io", "istio.io", "helm.sh",
    "sourcegraph.com", "code.gitea.io", "gitea.com", "storj.io", "modernc.org", "rsc.io", "mvdan.cc",
    "lukechampine.com", "filippo.io", "howett.net", "nhooyr.io", "gonum.org", "gioui.org", "fyne.io",
    "entgo.io", "ariga.io", "dario.cat", "oras.land", "knative.dev", "capnproto.org", "buf.build",
}
