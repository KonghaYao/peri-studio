import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RadioGroup } from './RadioGroup';
import { QuestionnaireCheckboxOption, QuestionnaireRadioOption } from './QuestionnaireOptionRow';

afterEach(() => cleanup());

describe('QuestionnaireOptionRow', () => {
  it('renders keyed radio options inside RadioGroup', async () => {
    const onChange = vi.fn();
    render(() => (
      <RadioGroup value="" onChange={onChange}>
        <QuestionnaireRadioOption
          value="safe"
          index={0}
          label="Safe mode"
          description="Fewer side effects"
        />
      </RadioGroup>
    ));

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('Safe mode')).toBeInTheDocument();
    expect(screen.getByText('Fewer side effects')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('radio', { name: /Safe mode/ }));
    expect(onChange).toHaveBeenCalledWith('safe');
  });

  it('renders keyed checkbox options', async () => {
    const onChange = vi.fn();
    render(() => (
      <QuestionnaireCheckboxOption
        checked={false}
        index={1}
        label="Docs"
        description="Update documentation"
        onChange={onChange}
      />
    ));

    expect(screen.getByText('B')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('checkbox', { name: /Docs/ }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
