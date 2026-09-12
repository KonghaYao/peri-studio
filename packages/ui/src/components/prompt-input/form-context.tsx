import { createContext, useContext, type Accessor } from 'solid-js';

export interface PromptInputFormContextValue {
  text: Accessor<string>;
  setText: (value: string) => void;
  isEmpty: Accessor<boolean>;
  submit: () => void;
}

const PromptInputFormContext = createContext<PromptInputFormContextValue>();

export function usePromptInputContext(component: string): PromptInputFormContextValue {
  const context = useContext(PromptInputFormContext);
  if (!context) {
    throw new Error(`${component} must be used within PromptInput`);
  }
  return context;
}

export function usePromptInput() {
  return usePromptInputContext('usePromptInput');
}

export { PromptInputFormContext };
