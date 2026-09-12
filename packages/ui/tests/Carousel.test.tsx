import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from '../src/components/Carousel';

afterEach(() => cleanup());

function renderCarousel() {
  return render(() => (
    <Carousel aria-label="Photo gallery">
      <CarouselContent>
        <CarouselItem>Slide 1</CarouselItem>
        <CarouselItem>Slide 2</CarouselItem>
        <CarouselItem>Slide 3</CarouselItem>
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  ));
}

describe('Carousel', () => {
  it('renders region semantics and slide groups', () => {
    renderCarousel();

    const region = screen.getByRole('region', { name: 'Photo gallery' });
    expect(region).toHaveAttribute('aria-roledescription', 'carousel');

    const slides = screen.getAllByRole('group');
    expect(slides).toHaveLength(3);
    slides.forEach((slide) => {
      expect(slide).toHaveAttribute('aria-roledescription', 'slide');
    });
  });

  it('disables previous on first slide and next on last slide', () => {
    renderCarousel();

    const previous = screen.getByRole('button', { name: 'Previous slide' });
    const next = screen.getByRole('button', { name: 'Next slide' });

    expect(previous).toBeDisabled();
    expect(next).not.toBeDisabled();
  });

  it('navigates with next button via scrollIntoView', () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    renderCarousel();

    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'start',
    });
  });

  it('navigates with arrow keys when focused', () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    renderCarousel();

    const region = screen.getByRole('region', { name: 'Photo gallery' });
    region.focus();

    fireEvent.keyDown(region, { key: 'ArrowRight' });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(region, { key: 'ArrowLeft' });
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('exposes CarouselApi through setApi', () => {
    const [api, setApi] = createSignal<CarouselApi>();

    render(() => (
      <Carousel setApi={setApi} aria-label="API carousel">
        <CarouselContent>
          <CarouselItem>One</CarouselItem>
          <CarouselItem>Two</CarouselItem>
        </CarouselContent>
      </Carousel>
    ));

    const instance = api();
    expect(instance).toBeDefined();
    expect(instance?.scrollSnapList()).toEqual([0, 1]);
    expect(instance?.selectedScrollSnap()).toBe(0);
    expect(instance?.canScrollPrev()).toBe(false);
    expect(instance?.canScrollNext()).toBe(true);
  });
});
