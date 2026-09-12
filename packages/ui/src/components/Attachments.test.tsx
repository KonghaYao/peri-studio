import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  formatAttachmentSize,
} from './Attachments';

afterEach(() => {
  cleanup();
});

const sampleAttachment = {
  id: 'file-1',
  name: 'diagram.png',
  size: 2048,
  mediaType: 'image/png',
  url: 'https://example.com/diagram.png',
};

describe('Attachments', () => {
  it('renders list rows with preview, size, and progress', () => {
    render(() => (
      <Attachments variant="list">
        <Attachment
          data={sampleAttachment}
          onRemove={() => undefined}
        >
          <AttachmentPreview />
          <AttachmentInfo />
          <AttachmentRemove />
        </Attachment>
        <Attachment
          data={{
            id: 'file-2',
            name: 'notes.txt',
            size: 512,
            mediaType: 'text/plain',
            progress: 40,
          }}
          onRemove={() => undefined}
        >
          <AttachmentPreview />
          <AttachmentInfo />
          <AttachmentRemove />
        </Attachment>
      </Attachments>
    ));

    expect(screen.getByText('diagram.png')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(screen.getByText('512 B')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getAllByRole('button', { name: 'Remove attachment' })).toHaveLength(2);
  });

  it('calls onRemove when the remove button is clicked', () => {
    const onRemove = vi.fn();

    render(() => (
      <Attachments>
        <Attachment data={sampleAttachment} onRemove={onRemove}>
          <AttachmentPreview />
          <AttachmentInfo />
          <AttachmentRemove />
        </Attachment>
      </Attachments>
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Remove attachment' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('hides the remove button when onRemove is not provided', () => {
    render(() => (
      <Attachments>
        <Attachment data={sampleAttachment}>
          <AttachmentPreview />
          <AttachmentInfo />
          <AttachmentRemove />
        </Attachment>
      </Attachments>
    ));

    expect(screen.queryByRole('button', { name: 'Remove attachment' })).not.toBeInTheDocument();
  });

  it('formats attachment sizes for display helpers', () => {
    expect(formatAttachmentSize(900)).toBe('900 B');
    expect(formatAttachmentSize(2048)).toBe('2.0 KB');
    expect(formatAttachmentSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
