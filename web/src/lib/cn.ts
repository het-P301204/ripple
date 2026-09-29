import clsx, { type ClassValue } from 'clsx'

/** className joiner (clsx). */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}
