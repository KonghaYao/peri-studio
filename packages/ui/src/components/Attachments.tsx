import { FileText, Globe, Image, Music2, Paperclip, Video, X } from 'lucide-solid';
import {
  createContext,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';
import { Badge } from './Badge';
import { IconButton } from './Button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from './Item';
import { Progress, ProgressFill, ProgressTrack } from './Progress';

export type AttachmentMediaCategory = 'image' | 'video' | 'audio' | 'document' | 'source' | 'unknown';

export type AttachmentVariant = 'grid' | 'inline' | 'list';

export type AttachmentData = {
  id: string;
  name: string;
  size?: number;
  mediaType?: string;
  url?: string;
  /** AI Elements 对齐：来源文档附件。 */
  kind?: 'file' | 'source';
  /** 0–100；未定义表示已完成或无进度。 */
  progress?: number;
};

const mediaCategoryIcons = {
  audio: Music2,
  document: FileText,
  image: Image,
  source: Globe,
  unknown: Paperclip,
  video: Video,
} as const;

export function formatAttachmentSize(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getMediaCategory(data: AttachmentData): AttachmentMediaCategory {
  if (data.kind === 'source') return 'source';
  const mediaType = data.mediaType ?? '';
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType.startsWith('video/')) return 'video';
  if (mediaType.startsWith('audio/')) return 'audio';
  if (mediaType.startsWith('application/') || mediaType.startsWith('text/')) return 'document';
  return 'unknown';
}

export function getAttachmentLabel(data: AttachmentData): string {
  const category = getMediaCategory(data);
  if (category === 'source') return data.name || 'Source';
  return data.name || (category === 'image' ? 'Image' : 'Attachment');
}

interface AttachmentsContextValue {
  variant: () => AttachmentVariant;
}

interface AttachmentContextValue {
  data: () => AttachmentData;
  mediaCategory: () => AttachmentMediaCategory;
  onRemove?: () => void;
  variant: () => AttachmentVariant;
}

const AttachmentsContext = createContext<AttachmentsContextValue>();
const AttachmentContext = createContext<AttachmentContextValue>();

function useAttachmentsContext(): AttachmentsContextValue {
  const context = useContext(AttachmentsContext);
  return context ?? { variant: () => 'list' };
}

function useAttachmentContext(component: string): AttachmentContextValue {
  const context = useContext(AttachmentContext);
  if (!context) {
    throw new Error(`${component} must be used within Attachment`);
  }
  return context;
}

type AttachmentsProps = ComponentProps<'div'> & {
  variant?: AttachmentVariant;
};

/** 附件列表容器。 */
export const Attachments: Component<AttachmentsProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'variant']);
  const variant = () => local.variant ?? 'list';

  const containerClass = () => {
    switch (variant()) {
      case 'grid':
        return 'grid grid-cols-[repeat(auto-fill,minmax(var(--composer-upload-tile-width),1fr))] gap-8';
      case 'inline':
        return 'flex flex-wrap gap-6';
      default:
        return 'flex flex-col gap-4';
    }
  };

  return (
    <AttachmentsContext.Provider value={{ variant }}>
      <div
        data-slot="attachments"
        data-variant={variant()}
        class={cn(containerClass(), local.class)}
        {...rest}
      />
    </AttachmentsContext.Provider>
  );
};

type AttachmentProps = ComponentProps<'div'> & {
  data: AttachmentData;
  onRemove?: () => void;
};

/** 单个附件项：向子组件提供 data 与 variant 上下文。 */
export const Attachment: Component<AttachmentProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'data', 'onRemove', 'children']);
  const { variant } = useAttachmentsContext();
  const mediaCategory = () => getMediaCategory(local.data);

  const contextValue: AttachmentContextValue = {
    data: () => local.data,
    mediaCategory,
    onRemove: local.onRemove,
    variant,
  };

  const shellClass = () => {
    switch (variant()) {
      case 'grid':
        return 'relative flex aspect-square items-center justify-center overflow-hidden rounded-8 border border-border-subtle bg-surface-muted';
      case 'inline':
        return 'inline-flex max-w-full items-center gap-6';
      default:
        return undefined;
    }
  };

  const content = (
    <AttachmentContext.Provider value={contextValue}>
      {variant() === 'list' ? (
        <Item
          data-slot="attachment"
          data-media={mediaCategory()}
          class={cn('px-8 py-8', local.class)}
          {...rest}
        >
          {local.children}
        </Item>
      ) : (
        <div
          data-slot="attachment"
          data-media={mediaCategory()}
          class={cn(shellClass(), local.class)}
          {...rest}
        >
          {local.children}
        </div>
      )}
    </AttachmentContext.Provider>
  );

  return content;
};

type AttachmentPreviewProps = ComponentProps<'div'> & {
  fallbackIcon?: JSX.Element;
};

/** 附件预览：图片缩略图或类型图标。 */
export const AttachmentPreview: Component<AttachmentPreviewProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'fallbackIcon']);
  const { data, mediaCategory, variant } = useAttachmentContext('AttachmentPreview');

  const renderIcon = (Icon: typeof Image) => {
    const size = variant() === 'inline' ? 12 : 16;
    return <Icon size={size} strokeWidth={1.7} aria-hidden="true" />;
  };

  const renderContent = () => {
    if (mediaCategory() === 'image' && data().url) {
      return (
        <img
          src={data().url}
          alt={getAttachmentLabel(data())}
          class={cn(
            'object-cover',
            variant() === 'grid'
              ? 'size-full'
              : 'size-32 rounded-6 border border-border-subtle',
          )}
        />
      );
    }

    const Icon = mediaCategoryIcons[mediaCategory()];
    return local.fallbackIcon ?? renderIcon(Icon);
  };

  if (variant() === 'list') {
    return (
      <ItemMedia
        data-slot="attachment-preview"
        class={cn(
          'size-32 overflow-hidden rounded-6 border border-border-subtle bg-surface-muted text-content-secondary',
          local.class,
        )}
        {...rest}
      >
        <span class="flex size-full items-center justify-center">{renderContent()}</span>
      </ItemMedia>
    );
  }

  return (
    <div
      data-slot="attachment-preview"
      class={cn(
        'flex shrink-0 items-center justify-center text-content-secondary',
        variant() === 'inline' ? 'size-16' : 'size-full',
        local.class,
      )}
      {...rest}
    >
      {renderContent()}
    </div>
  );
};

type AttachmentInfoProps = {
  class?: string;
  showMediaType?: boolean;
};

/** 附件名称、大小与可选上传进度。 */
export const AttachmentInfo: Component<AttachmentInfoProps> = (props) => {
  const [local] = splitProps(props, ['class', 'showMediaType']);
  const { data, variant } = useAttachmentContext('AttachmentInfo');
  const label = () => getAttachmentLabel(data());
  const sizeLabel = () => formatAttachmentSize(data().size);
  const showProgress = () => data().progress !== undefined && data().progress! < 100;

  if (variant() === 'grid') {
    return null;
  }

  if (variant() === 'inline') {
    return (
      <span data-slot="attachment-info" class={cn('inline-flex max-w-full', local.class)}>
        <Badge class="max-w-48 truncate">{label()}</Badge>
      </span>
    );
  }

  return (
    <ItemContent data-slot="attachment-info" class={cn('gap-6', local.class)}>
      <ItemTitle class="truncate">{label()}</ItemTitle>
      <ItemDescription class="flex flex-col gap-6">
        <span class="flex items-center gap-8">
          {sizeLabel() && <span>{sizeLabel()}</span>}
          {local.showMediaType && data().mediaType && (
            <span class="truncate text-content-muted">{data().mediaType}</span>
          )}
        </span>
        {showProgress() && (
          <Progress value={data().progress} class="w-full">
            <ProgressTrack>
              <ProgressFill />
            </ProgressTrack>
          </Progress>
        )}
      </ItemDescription>
    </ItemContent>
  );
};

type AttachmentRemoveProps = Omit<ComponentProps<typeof IconButton>, 'label'> & {
  label?: string;
};

/** 移除附件按钮；无 onRemove 时不渲染。 */
export const AttachmentRemove: Component<AttachmentRemoveProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'label', 'onClick']);
  const { onRemove, variant } = useAttachmentContext('AttachmentRemove');

  const handleClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent> = (event) => {
    event.stopPropagation();
    const click = local.onClick;
    if (typeof click === 'function') click(event);
    if (!event.defaultPrevented) {
      onRemove?.();
    }
  };

  if (!onRemove) {
    return null;
  }

  const button = (
    <IconButton
      type="button"
      data-slot="attachment-remove"
      variant="ghost"
      size="sm"
      label={local.label ?? 'Remove attachment'}
      showTooltip={false}
      class={cn(
        variant() === 'grid' ? 'absolute top-4 right-4 bg-surface-overlay' : undefined,
        local.class,
      )}
      onClick={handleClick}
      {...rest}
    >
      <X size={14} strokeWidth={1.7} aria-hidden="true" />
    </IconButton>
  );

  if (variant() === 'list') {
    return <ItemActions>{button}</ItemActions>;
  }

  return button;
};
