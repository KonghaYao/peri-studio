import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { resetResourceProject, setResourceFilePreview } from '../lib/resource-store';
import { ResourceFileEditor } from './ResourceFileEditor';

afterEach(() => { cleanup(); resetResourceProject(); });

describe('VS Code-style file editor', () => {
  it('renders a read-only text file with stable line numbers', () => {
    setResourceFilePreview({
      requestId: 'file-1', path: 'src/main.ts', loading: false, mode: 'text',
      url: '/api/resource-blobs/blob-1', contentType: 'text/plain', size: 25,
      text: 'const answer = 42;\nexport { answer };\n',
    });

    render(() => <ResourceFileEditor />);
    expect(screen.getByLabelText('File preview')).toBeInTheDocument();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Contents of src/main.ts' })).toBeInTheDocument();
    expect(screen.getByText('const answer = 42;')).toBeInTheDocument();
    expect(screen.getByText('export { answer };')).toBeInTheDocument();
    expect(screen.getByLabelText('Download file')).toBeInTheDocument();
  });

  it('renders images through the principal-bound URL and closes with Escape', () => {
    setResourceFilePreview({
      requestId: 'file-2', path: 'assets/logo.png', loading: false, mode: 'image',
      url: '/api/resource-blobs/blob-2', contentType: 'image/png', size: 2048,
    });

    render(() => <ResourceFileEditor />);
    expect(screen.getByAltText('Preview of logo.png')).toHaveAttribute('src', '/api/resource-blobs/blob-2');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('assets/logo.png')).not.toBeInTheDocument();
  });

  it('keeps binary content out of the text surface and offers download', () => {
    setResourceFilePreview({
      requestId: 'file-3', path: 'target/app.bin', loading: false, mode: 'binary',
      url: '/api/resource-blobs/blob-3', contentType: 'application/octet-stream', size: 4096,
    });

    render(() => <ResourceFileEditor />);
    expect(screen.getByText('The file is not displayed in the text editor')).toBeInTheDocument();
    expect(screen.getByText(/4\.0 KB/)).toBeInTheDocument();
    expect(screen.getAllByText('Download file')).toHaveLength(1);
  });
});
