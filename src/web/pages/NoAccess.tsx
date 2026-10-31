export function NoAccess({ code, message }: { code: string; message: string }) {
  const inUse = code === 'tenant_in_use';
  return (
    <section className="center">
      <div className="card" style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: 24 }}>{inUse ? 'You need an invitation' : 'We could not sign you in here'}</h1>
        <p>{message}</p>
        {inUse && (
          <p className="muted">
            Each organization has one owner, the first person who signed in. The owner can invite you on the Team page. Once you are invited, reload this page.
            The name and address above are partly hidden to protect the owner's privacy.
          </p>
        )}
        <div className="row">
          <button className="primary" onClick={() => location.reload()}>Try again</button>
        </div>
      </div>
    </section>
  );
}
