import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Col, Row } from './Grid';

afterEach(() => cleanup());

describe('Grid', () => {
  it('renders row and col with data-slot', () => {
    render(() => (
      <Row data-testid="row" gutter="middle">
        <Col span={12} data-testid="col">A</Col>
        <Col span={12}>B</Col>
      </Row>
    ));

    expect(screen.getByTestId('row')).toHaveAttribute('data-slot', 'row');
    expect(screen.getByTestId('col')).toHaveAttribute('data-slot', 'col');
  });

  it('applies span width style on col', () => {
    render(() => (
      <Row>
        <Col span={6} data-testid="col">Half</Col>
      </Row>
    ));

    const col = screen.getByTestId('col');
    expect(col.style.flex).toBe('0 0 25%');
  });
});
