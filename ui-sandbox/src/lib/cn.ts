import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/* text-9…text-28 是字号，不是颜色。不登记的话 twMerge 会把
   text-13 和 text-content-on-accent 当成冲突，primary 按钮蓝底黑字。 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{
        text: ['9', '10', '11', '12', '13', '14', '15', '16', '18', '24', '28', 'caption', 'body', 'title', 'display'],
      }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
