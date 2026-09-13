import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Image, ImagePreview } from './Image';

afterEach(() => {
  cleanup();
});

describe('Image', () => {
  it('opens fullscreen preview with the image when clicked', async () => {
    render(() => (
      <Image src="https://example.com/photo.jpg" alt="Workspace" preview />
    ));

    fireEvent.click(screen.getByRole('img', { name: 'Workspace' }));

    const preview = await screen.findByTestId('image-preview') as HTMLImageElement;
    expect(preview.src).toBe('https://example.com/photo.jpg');
    expect(preview).toBeVisible();
    expect(screen.getByRole('dialog')).toBeVisible();
  });
});

describe('ImagePreview', () => {
  it('renders preview image inside fullscreen dialog content', () => {
    render(() => (
      <ImagePreview
        open
        onOpenChange={() => undefined}
        src="https://example.com/gallery.jpg"
        alt="Gallery"
      />
    ));

    const preview = screen.getByTestId('image-preview') as HTMLImageElement;
    expect(preview.src).toBe('https://example.com/gallery.jpg');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
