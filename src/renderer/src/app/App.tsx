function App(): React.JSX.Element {
  const status = window.healthScreening.getApplicationStatus()

  return (
    <main className="foundation-shell" aria-labelledby="application-title">
      <section className="foundation-panel">
        <div className="foundation-eyebrow">{status.status}</div>
        <h1 id="application-title">{status.applicationName}</h1>
        <p className="foundation-statement">No clinical features are implemented yet.</p>
        <dl className="foundation-status" aria-label="Bootstrap scope status">
          <div>
            <dt>Clinical workflows</dt>
            <dd>{status.clinicalFeaturesImplemented ? 'Implemented' : 'Not implemented'}</dd>
          </div>
          <div>
            <dt>Database</dt>
            <dd>{status.databaseConfigured ? 'Configured' : 'Not configured'}</dd>
          </div>
          <div>
            <dt>Business IPC</dt>
            <dd>{status.businessIpcImplemented ? 'Implemented' : 'Not implemented'}</dd>
          </div>
        </dl>
      </section>
    </main>
  )
}

export default App
