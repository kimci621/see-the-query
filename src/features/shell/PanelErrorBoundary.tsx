import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { Locale } from '@/lib/i18n';
import { message } from '@/lib/messages';

interface Props {
  name: string;
  locale?: Locale;
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
    const locale = this.props.locale ?? 'ru';
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm"
      >
        <p className="font-medium">
          {locale === 'en' ? `${this.props.name} panel failed` : `Панель «${this.props.name}» упала`}
        </p>
        <p className="max-w-md font-mono text-xs text-muted-foreground">{error.message}</p>
        <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
          {message(locale, 'Перезапустить панель')}
        </Button>
      </div>
    );
  }
}
