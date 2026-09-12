import type { ClassValue } from "clsx"
import { clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

const FONT_SIZE_TEXT = [
  "9",
  "10",
  "10p5",
  "11",
  "11p5",
  "12",
  "12p5",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "24",
  "28",
  "caption",
  "body",
  "title",
  "display",
] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...FONT_SIZE_TEXT] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function clamp(val: number, min: number, max: number) {
  return val > max ? max : val < min ? min : val
}

export function toggleValue<T>(array: T[], value: T): T[] {
  return array.includes(value) ? array.filter((item) => item !== value) : [...array, value]
}
