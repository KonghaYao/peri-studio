import type { SafeImageProps } from '@peri/ui';
import { SafeImage as UiSafeImage } from '@peri/ui';

/** Catalog 默认直出远程图。 */
export function SafeImage(props: SafeImageProps) {
  return <UiSafeImage {...props} requireConsent={props.requireConsent ?? false} />;
}
