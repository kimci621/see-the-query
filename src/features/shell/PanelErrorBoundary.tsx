import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  name: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Падение одной панели не должно ронять остальные
export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}]`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm"
      >
        <p className="font-medium">Панель «{this.props.name}» упала</p>
        <p className="max-w-md font-mono text-xs text-muted-foreground">{error.message}</p>
        <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
          Перезапустить панель
        </Button>
      </div>
    );
  }
}
