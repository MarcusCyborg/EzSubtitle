type StatusMessageProps = {
  kind: 'loading' | 'error' | 'info';
  children: React.ReactNode;
};

export function StatusMessage({ kind, children }: StatusMessageProps) {
  return (
    <div className={`status-message status-message--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'loading' && <span className="spinner" aria-hidden="true" />}
      <span>{children}</span>
    </div>
  );
}
