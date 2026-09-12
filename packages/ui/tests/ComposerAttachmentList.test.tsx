import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ComposerAttachmentList } from '../src/components/composer/ComposerAttachmentList';

afterEach(() => cleanup());

describe('ComposerAttachmentList', () => {
  it('renders upload tiles for ready attachments', () => {
    render(() => (
      <ComposerAttachmentList
        items={[
          { id: 'api', name: 'api.ts', status: 'ready' },
          { id: 'schema', name: 'schema.json', status: 'uploading', progress: 38 },
        ]}
      />
    ));

    expect(screen.getByRole('list', { name: 'Attached files' })).toHaveClass('ui-attachment-list');
    expect(screen.getByText('api.ts')).toBeInTheDocument();
    expect(screen.getByText('schema.json')).toBeInTheDocument();
  });
});
