import type { Component } from 'solid-js';
import {
  QuestionnaireFrame,
  type QuestionnaireFrameProps,
  type QuestionnaireOption,
} from './QuestionnaireFrame';

export type DecisionOption = QuestionnaireOption;

export type DecisionCardProps = QuestionnaireFrameProps;

/** @deprecated 使用 Questionnaire 或 QuestionnaireFrame。 */
export const DecisionCard: Component<DecisionCardProps> = (props) => (
  <QuestionnaireFrame data-slot="decision-card" {...props} />
);
