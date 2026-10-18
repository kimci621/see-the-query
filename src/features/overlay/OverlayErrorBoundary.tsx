import { Component, type ReactNode } from 'react';

interface Props {
  resetKey: unknown;
  onError: (error: Error) => void;
  children: ReactNode;
}

interface State {
  failed: boolean;
  key: unknown;
}

// Ошибка рендера сцены не должна ронять доску и редактор: сцена просто закрывается
export class OverlayErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    if (import.meta.env.DEV) console.error('[overlay] ошибка сцены', error);
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
