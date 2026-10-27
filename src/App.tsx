import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { applySessionRepair, codeAfterRepair, runDiagnosticSession } from "./core/engine";
import { adapterForLevel } from "./core/models";
import { runProductBenchmark, type BenchmarkReport } from "./core/benchmark";
import { runProductQa, type ProductQaReport } from "./core/productQa";
import { createBrowserPythonRuntime, type PythonExecutionResult, type PythonRuntime } from "./core/pythonRuntime";
import { retrySessionRepair } from "./core/retry";
import { SAMPLE_CASES, type SampleCase } from "./core/samples";
import { loadSourceFile } from "./core/sourceLoader";
import { createBrowserMindMemory } from "./core/memory";
import type { DiagnosticSession, FunctionFlag } from "./core/types";
import { EscalationPanel } from "./components/EscalationPanel";
import { useModelSetup } from "./components/useModelSetup";

function statusLabel(session: DiagnosticSession | undefined): string {
  if (!session) return "Esperando código";
  if (session.status === "verified") return "Checker aprobado";
  if (session.status === "failed") return "Revisión requerida";
  return "Diagnóstico listo";
}

function flagIcon(flag: FunctionFlag): string {
  if (flag.level === "error") return "!";
  if (flag.level === "success") return "✓";
  return "·";
}

function executionStatusLabel(result: PythonExecutionResult): string {
  if (result.status === "success") return "Ejecución aprobada";
  if (result.status === "timeout") return "Tiempo agotado";
  if (result.status === "unavailable") return "Runtime no disponible";
  return "Traceback capturado";
}

type MemoryStatus = "loading" | "empty" | "saved" | "unavailable";

function memoryStatusLabel(status: MemoryStatus): string {
  if (status === "loading") return "CARGANDO";
  if (status === "saved") return "GUARDADA";
  if (status === "unavailable") return "NO DISPONIBLE";
  return "VACÍA";
}

export function App() {
  const [selectedSample, setSelectedSample] = useState<SampleCase>(SAMPLE_CASES[0]);
  const [code, setCode] = useState(SAMPLE_CASES[0].code);
  const [traceback, setTraceback] = useState(SAMPLE_CASES[0].traceback);
  const [session, setSession] = useState<DiagnosticSession>();
  const [toast, setToast] = useState<string>();
  const [benchmarkMode, setBenchmarkMode] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [productQa, setProductQa] = useState<ProductQaReport>();
  const [benchmark, setBenchmark] = useState<BenchmarkReport>();
  const [execution, setExecution] = useState<PythonExecutionResult>();
  const [executionFlags, setExecutionFlags] = useState<FunctionFlag[]>([]);
  const [executing, setExecuting] = useState(false);
  const [memoryReady, setMemoryReady] = useState(false);
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus>("loading");
  // Modelos de Meta por proxy (la key queda en el servidor) o, con ?replay, desde grabaciones.
  const models = useModelSetup();
  // En replay nada sale a la red, así que no hace falta el modo benchmark para escalar.
  const modelAdapters = benchmarkMode || models.mode === "replay" ? models.adapters : [];
  const pythonRuntime = useRef<PythonRuntime | undefined>(undefined);
  const memory = useRef(createBrowserMindMemory());
  const fileInput = useRef<HTMLInputElement>(null);
  const executionGeneration = useRef(0);

  useEffect(() => () => {
    pythonRuntime.current?.dispose();
  }, []);

  useEffect(() => {
    let active = true;
    void memory.current.load().then((snapshot) => {
      if (!active) return;
      if (snapshot.source) {
        const restoredSample = SAMPLE_CASES.find((sample) => sample.id === snapshot.source?.selectedSampleId);
        if (restoredSample) setSelectedSample(restoredSample);
        setCode(snapshot.source.code);
        setTraceback(snapshot.source.traceback);
        setBenchmarkMode(snapshot.source.benchmarkMode);
      }
      if (snapshot.session?.session) setSession(snapshot.session.session);
      if (snapshot.session?.productQa) setProductQa(snapshot.session.productQa);
      if (snapshot.benchmark?.report) setBenchmark(snapshot.benchmark.report);
      setMemoryStatus(snapshot.source ? "saved" : "empty");
    }).catch(() => {
      if (active) setMemoryStatus("unavailable");
    }).finally(() => {
      if (active) setMemoryReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!memoryReady) return;
    const timer = window.setTimeout(() => {
      void memory.current.save({
        source: {
          selectedSampleId: selectedSample.id,
          benchmarkMode,
          code,
          traceback,
        },
        session: session || productQa ? { session, productQa } : undefined,
        benchmark: benchmark ? { report: benchmark } : undefined,
      }).then(() => setMemoryStatus("saved")).catch(() => setMemoryStatus("unavailable"));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [benchmark, benchmarkMode, code, memoryReady, productQa, selectedSample.id, session, traceback]);

  const passedChecks = session?.checkers.filter((checker) => checker.passed).length ?? 0;

  function clearExecution(): void {
    executionGeneration.current += 1;
    setExecution(undefined);
    setExecutionFlags([]);
    setExecuting(false);
  }

  function loadSample(id: string): void {
    const sample = SAMPLE_CASES.find((item) => item.id === id) ?? SAMPLE_CASES[0];
    setSelectedSample(sample);
    setCode(sample.code);
    setTraceback(sample.traceback);
    setSession(undefined);
    clearExecution();
    setToast(undefined);
  }

  function resetSession(): void {
    setSession(undefined);
  }

  async function clearMemory(): Promise<void> {
    try {
      await memory.current.clear();
      setMemoryStatus("empty");
      setToast("Memoria local borrada. El código actual sigue visible hasta que cambies de caso o recargues.");
    } catch (error) {
      setMemoryStatus("unavailable");
      setToast(error instanceof Error ? error.message : "No se pudo borrar la memoria local.");
    }
  }

  // Una edición invalida el análisis: aplicar un patch viejo pisaría lo que el usuario escribió.
  function editCode(value: string): void {
    setCode(value);
    clearExecution();
    resetSession();
  }

  function editTraceback(value: string): void {
    setTraceback(value);
    clearExecution();
    resetSession();
  }

  function toggleBenchmarkMode(enabled: boolean): void {
    setBenchmarkMode(enabled);
    resetSession();
  }

  function runProductQaCheck(): void {
    const report = runProductQa();
    setProductQa(report);
    setToast(report.failed === 0
      ? `QA del producto aprobada: ${report.passed}/${report.total} casos.`
      : `QA del producto con fallos: ${report.passed}/${report.total} casos.`);
  }

  function runBenchmarkCheck(): void {
    const report = runProductBenchmark();
    setBenchmark(report);
    setToast(`Benchmark reproducible: ${report.resolved}/${report.attempted} tareas resueltas; ${report.notConfigured} quedan sin modelo conectado.`);
  }

  async function loadFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const loaded = loadSourceFile(file.name, await file.text());
      setCode(loaded.code);
      setTraceback("");
      resetSession();
      clearExecution();
      setToast(`Fuente cargada: ${loaded.name}. Revisá el código y ejecutá el análisis.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "No se pudo cargar la fuente.");
    }
  }

  async function executePython(): Promise<void> {
    const generation = ++executionGeneration.current;
    setExecuting(true);
    setExecution(undefined);
    setExecutionFlags([]);
    try {
      pythonRuntime.current ??= createBrowserPythonRuntime();
      const result = await pythonRuntime.current.run({ code, timeoutMs: 30_000 }, (flag) => {
        if (generation !== executionGeneration.current) return;
        setExecutionFlags((previous) => [...previous, flag]);
      });
      if (generation !== executionGeneration.current) return;
      setExecution(result);
      setToast(result.status === "success"
        ? "Python ejecutado localmente en el Web Worker."
        : `${executionStatusLabel(result)}: ${result.error ?? result.traceback ?? "revisá la salida."}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Falló la ejecución local de Python.");
    } finally {
      if (generation === executionGeneration.current) setExecuting(false);
    }
  }

  function analyzeTraceback(nextTraceback: string): void {
    try {
      const nextSession = runDiagnosticSession(code, nextTraceback, modelAdapters);
      setSession(nextSession);
      setToast(nextSession.patch
        ? "Diagnóstico listo: hay una reparación verificable."
        : `Diagnóstico listo: requiere revisión manual (escalamiento sugerido: ${nextSession.escalation.model}).`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Falló el diagnóstico.");
    }
  }

  function analyze(): void {
    analyzeTraceback(traceback);
  }

  function analyzeCapturedTraceback(): void {
    if (!execution?.traceback) return;
    setTraceback(execution.traceback);
    analyzeTraceback(execution.traceback);
  }

  // Verifica el patch ejecutándolo con Pyodide, sólo si el usuario ya ejecutó Python en esta sesión.
  async function runPatched(patchedCode: string): Promise<string | undefined> {
    if (!execution || !pythonRuntime.current) return undefined;
    const result = await pythonRuntime.current.run({ code: patchedCode, timeoutMs: 30_000 });
    return result.status === "error" ? result.traceback ?? result.error ?? "Error al ejecutar el patch." : undefined;
  }

  async function retryRepair(): Promise<void> {
    if (!session?.patch || session.patch.origin !== "model") return;
    const adapter = adapterForLevel(models.adapters, session.escalation.level);
    if (!adapter) return;
    setRetrying(true);
    try {
      const result = await retrySessionRepair(session, adapter, { maxAttempts: 2, maxAdditionalTokens: 1_024 });
      setSession(result.session);
      if (result.session.status === "verified") {
        setCode(codeAfterRepair(result.session, code));
        setToast(`Reintento aprobado por los checkers después de ${result.attempts} intento(s).`);
      } else {
        setToast(`Reintento detenido: ${result.stopReason}. El código original se conserva.`);
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Falló el reintento del patch.");
    } finally {
      setRetrying(false);
    }
  }

  function applyRepair(): void {
    if (!session?.patch) {
      setToast("No hay una reparación segura disponible para este caso.");
      return;
    }
    try {
      const repaired = applySessionRepair(session);
      setSession(repaired);
      setCode(codeAfterRepair(repaired, code));
      setToast(repaired.status === "verified"
        ? "Patch aplicado y aprobado por los checkers."
        : "Un checker rechazó el patch: tu código quedó como estaba. Revisá el diff.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Falló la aplicación del patch.");
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">B</div>
          <div>
            <div className="eyebrow">PRIVATE DEBUGGING AGENT</div>
            <h1>BrowserMind <span>Data</span></h1>
          </div>
        </div>
        <div className="topbar-meta">
          <span className="privacy-pill"><span className="pulse" /> Local-first</span>
          <span className="version">MVP / v0.1</span>
        </div>
      </header>

      <section className="hero-row">
        <div>
          <p className="kicker">DIAGNÓSTICO ESTRUCTURAL · PYTHON DATA SCIENCE</p>
          <h2>Encontrá el problema.<br /><em>Verificá</em> la solución.</h2>
          <p className="hero-copy">Reglas locales primero. Contexto mínimo después. Cada propuesta pasa por un checker independiente antes de tocar tu código.</p>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-ring ring-one" />
          <div className="orbit-ring ring-two" />
          <div className="orbit-dot dot-a" />
          <div className="orbit-dot dot-b" />
          <div className="orbit-core">⌁</div>
        </div>
      </section>

      <section className="workspace-grid">
        <aside className="side-panel panel">
          <div className="panel-heading">
            <div><span className="section-index">01</span><h3>Reproducir caso</h3></div>
            <span className="tiny-status">SEED BENCH</span>
          </div>
          <label className="field-label" htmlFor="sample">Caso de benchmark</label>
          <select id="sample" value={selectedSample.id} onChange={(event) => loadSample(event.target.value)}>
            {SAMPLE_CASES.map((sample) => <option key={sample.id} value={sample.id}>{sample.label}</option>)}
          </select>
          <div className="sample-note"><span className="mini-icon">↳</span><span>{selectedSample.kind}</span></div>
          <div className="metric-stack">
            <div><span>Reglas locales</span><strong>ACTIVAS</strong></div>
            <div><span>Modelo externo</span><strong>{session?.metrics.calls ? `META · ${session.metrics.calls}` : models.mode === "replay" ? "REPLAY" : benchmarkMode ? "HABILITADO" : "NO USADO"}</strong></div>
            <div><span>Datos enviados</span><strong>0 filas</strong></div>
          </div>
          <label className="benchmark-toggle">
            <input type="checkbox" checked={benchmarkMode} onChange={(event) => toggleBenchmarkMode(event.target.checked)} />
            <span><strong>Modo benchmark Meta</strong>Permite enviar el contexto redactado a modelos de Meta (Muse Spark, o Glimmer si está configurado). Usalo sólo con datos sintéticos o públicos: con un endpoint remoto no hay privacidad total.</span>
          </label>
          <div className="scope-note"><span>i</span><p>{benchmarkMode ? "Sólo viaja lo que ves en «Contexto que viajaría», y únicamente cuando presionás «Escalar»." : "El contenido queda en esta sesión. Nada se envía a un modelo externo."}</p></div>
          <div className="scope-note memory-note"><span>⌁</span><div><p><strong>Memoria local · {memoryStatusLabel(memoryStatus)}</strong><br />Fuente, sesión y benchmark se guardan sólo en este navegador.</p><button type="button" className="button secondary memory-button" onClick={clearMemory}>Borrar memoria</button></div></div>
          <div className="example-card"><span className="label-muted">EJEMPLO GUIADO</span><strong>KeyError → columna existente</strong><p>Analizá el caso seleccionado y verificá que `revenue` se corrige a `revenue_total` sin llamar a una API.</p></div>
        </aside>

        <section className="editor-panel panel">
          <div className="panel-heading editor-heading">
            <div><span className="section-index">02</span><h3>Fuente y traceback</h3></div>
            <span className="file-chip">python · sesión local</span>
          </div>
          <label className="field-label" htmlFor="code">Código de entrada</label>
          <textarea id="code" className="code-editor" spellCheck={false} value={code} onChange={(event) => editCode(event.target.value)} />
          <label className="field-label" htmlFor="traceback">Traceback o descripción</label>
          <textarea id="traceback" className="traceback-editor" spellCheck={false} value={traceback} onChange={(event) => editTraceback(event.target.value)} />
          <div className="editor-actions">
            <div className="editor-tools">
              <button type="button" className="button secondary" onClick={() => fileInput.current?.click()}>Cargar fuente</button>
              <input ref={fileInput} className="file-input" type="file" accept=".py,.ipynb,.txt" onChange={loadFile} />
              <button type="button" className="button run-button" onClick={executePython} disabled={executing}>{executing ? "Cargando Pyodide…" : "Ejecutar Python"}<span>▶</span></button>
            </div>
            <button type="button" className="button primary" onClick={analyze}>Analizar localmente <span>→</span></button>
          </div>
          {execution && <section className={`execution-card ${execution.status}`} aria-live="polite">
            <div className="execution-heading"><div><span className="label-muted">RUNTIME LOCAL · PYODIDE</span><strong>{executionStatusLabel(execution)}</strong></div><span>{execution.durationMs}ms</span></div>
            {execution.packagesLoaded.length > 0 && <p className="execution-packages">Imports detectados: {execution.packagesLoaded.join(", ")}</p>}
            {execution.stdout && <pre><strong>stdout</strong>{execution.stdout}</pre>}
            {execution.stderr && <pre className="execution-stderr"><strong>stderr</strong>{execution.stderr}</pre>}
            {execution.traceback && <pre className="execution-traceback"><strong>traceback</strong>{execution.traceback}</pre>}
            {!execution.stdout && !execution.stderr && !execution.traceback && <p className="execution-empty">La ejecución terminó sin salida.</p>}
            {execution.traceback && <button type="button" className="button execution-analyze" onClick={analyzeCapturedTraceback}>Usar traceback y analizar <span>→</span></button>}
          </section>}
        </section>

        <section className="result-panel panel">
          <div className="panel-heading">
            <div><span className="section-index">03</span><h3>Resultado verificable</h3></div>
            <span className={`status-dot ${session?.status === "verified" ? "good" : ""}`} />
          </div>
          {!session ? (
            <div className="empty-state"><div className="empty-glyph">◌</div><h4>Esperando análisis</h4><p>Ejecutá el caso para ver clasificación, contexto, patch y checkers.</p></div>
          ) : (
            <>
              <div className="diagnostic-card">
                <div className="diagnostic-top"><span className="issue-tag">{session.diagnostic.kind}</span><span className="confidence">{Math.round(session.diagnostic.confidence * 100)}% confianza</span></div>
                <h4>{session.diagnostic.title}</h4>
                <p>{session.diagnostic.summary}</p>
                <div className="evidence"><span>evidence</span><code>{session.diagnostic.evidence}</code>{session.diagnostic.line !== undefined && <small>línea {session.diagnostic.line}</small>}</div>
              </div>
              <div className="context-row"><div><span className="label-muted">CONTEXTO SELECCIONADO</span><strong>{session.metrics.selectedLines} líneas · {session.context.symbols.length} símbolos</strong></div><code>{session.metrics.estimatedTokens} tokens estimados</code></div>
              {session.patch ? (
                <div className="patch-card"><div className="patch-heading"><span className="check-badge">✓</span><div><span className="label-muted">{session.patch.origin === "model" ? "PATCH GENERADO · VERIFICAR" : "PATCH DETERMINISTA"}</span><strong>{session.patch.title}</strong></div></div><p>{session.patch.explanation}</p><div className="diff"><span className="removed">− {session.patch.before}</span><span className="added">+ {session.patch.after}</span></div><button type="button" className="button patch-button" onClick={applyRepair} disabled={session.status !== "analyzed"}>{session.status === "verified" ? "Patch aplicado" : "Aplicar y verificar"}<span>↗</span></button>{session.status === "failed" && session.patch.origin === "model" && <button type="button" className="button retry-button" onClick={retryRepair} disabled={retrying}>{retrying ? "Reintentando…" : "Reintentar con feedback"}<span>↻</span></button>}</div>
              ) : <div className="manual-card"><span>!</span><div><strong>Revisión manual requerida</strong><p>{session.modelNote ?? session.diagnostic.nextStep}</p></div></div>}
              <EscalationPanel
                session={session}
                adapters={modelAdapters}
                notes={models.notes}
                runPatched={runPatched}
                onResult={(result) => {
                  setSession(result.session);
                  setCode(codeAfterRepair(result.session, code));
                  setToast(result.session.status === "verified" ? "Patch del modelo aprobado por los checkers." : "El modelo no logró un patch verificado: tu código quedó como estaba.");
                }}
                onError={setToast}
              />
              <div className="checker-list"><div className="subheading"><span>CHECKERS</span><strong>{passedChecks}/{session.checkers.length} aprobados</strong></div>{session.checkers.map((checker) => <div className="checker-row" key={checker.id}><span className={checker.passed ? "checker-ok" : "checker-fail"}>{checker.passed ? "✓" : "×"}</span><span>{checker.name}</span><small>{checker.message}</small></div>)}</div>
            </>
          )}
        </section>
      </section>

      <section className="observability-grid">
        <section className="panel timeline-panel">
          <div className="panel-heading"><div><span className="section-index">04</span><h3>Flags de ejecución</h3></div><span className="tiny-status">{statusLabel(session)}</span></div>
          <div className="timeline">{(session?.flags ?? executionFlags).filter((flag) => flag.phase !== "start").slice(-8).length > 0 ? (session?.flags ?? executionFlags).filter((flag) => flag.phase !== "start").slice(-8).map((flag) => <div className={`timeline-row ${flag.level}`} key={flag.id}><span className="timeline-icon">{flagIcon(flag)}</span><div><strong>{flag.functionName}</strong><p>{flag.message}</p></div><time>{flag.durationMs !== undefined ? `${flag.durationMs}ms` : "local"}</time></div>) : <div className="timeline-placeholder">Cada función publica inicio, resultado, duración y error ubicable.</div>}</div>
        </section>
        <section className="panel context-panel">
          <div className="panel-heading"><div><span className="section-index">05</span><h3>Contexto que viajaría</h3></div><span className="tiny-status">REDACTADO</span></div>
          <pre>{session?.context.payload ?? "Sin análisis todavía."}</pre>
          <div className="redaction-list">{(session?.context.redactions ?? ["rutas locales", "filas de dataset", "datos personales"]).map((item) => <span key={item}>⊘ {item}</span>)}</div>
        </section>
      </section>

      <section className="panel product-qa-panel">
        <div className="panel-heading"><div><span className="section-index">06</span><h3>QA del producto</h3></div><button type="button" className="button qa-button" onClick={runProductQaCheck}>Ejecutar QA completa <span>✓</span></button></div>
        <div className="qa-intro"><p>Valida diagnóstico, patch, checkers y revisión manual sobre los cinco casos semilla. No usa API externa.</p>{productQa && <strong className={productQa.failed === 0 ? "qa-pass" : "qa-fail"}>{productQa.passed}/{productQa.total} aprobados · {productQa.elapsedMs}ms</strong>}</div>
        {productQa ? <div className="qa-case-grid">{productQa.results.map((item) => <div className={`qa-case ${item.passed ? "passed" : "failed"}`} key={item.sampleId}><div><span className="qa-icon">{item.passed ? "✓" : "×"}</span><strong>{item.label}</strong></div><span className="qa-stage">{item.stage}</span><p>{item.message}</p><small>{item.passedCheckerCount}/{item.checkerCount} checkers</small></div>)}</div> : <div className="qa-empty">Todavía no se ejecutó la QA. Presioná el botón para obtener una evidencia reproducible del producto.</div>}
      </section>

      <section className="panel benchmark-panel">
        <div className="panel-heading"><div><span className="section-index">07</span><h3>Benchmark A–D</h3></div><button type="button" className="button qa-button" onClick={runBenchmarkCheck}>Ejecutar benchmark <span>↗</span></button></div>
        <div className="qa-intro"><p>20 tareas reproducibles: cinco casos por configuración. Sólo cuenta una reparación verificada; Glimmer y Spark no se simulan.</p>{benchmark && <strong className="qa-pass">{benchmark.resolved}/{benchmark.attempted} resueltas · {benchmark.notConfigured} sin configurar</strong>}</div>
        {benchmark ? <>
          <div className="benchmark-summary-grid">{benchmark.summaries.map((summary) => <div className={`benchmark-summary ${summary.notConfigured === summary.total ? "not-configured" : ""}`} key={summary.config}><div><span className="benchmark-letter">{summary.config}</span><strong>{summary.label}</strong></div><b>{summary.resolved}/{summary.attempted || summary.total}</b><small>{summary.notConfigured ? `${summary.notConfigured} sin modelo` : `${summary.totalTokens} tokens de contexto`}</small></div>)}</div>
          <div className="benchmark-task-list">{benchmark.tasks.map((task) => <div className={`benchmark-task ${task.status}`} key={task.id}><span className="benchmark-task-config">{task.config}</span><strong>{task.sampleLabel}</strong><span>{task.status === "resolved" ? "✓ resuelta" : task.status === "manual-review" ? "manual" : task.status === "not-configured" ? "sin configurar" : "falló"}</span><small>{task.message}</small><code>{task.totalTokens} tok · {task.elapsedMs}ms</code></div>)}</div>
        </> : <div className="qa-empty">Todavía no se ejecutó el benchmark. La configuración C/D queda visible como pendiente, no como éxito ficticio.</div>}
      </section>

      {toast && <div className="toast" role="status"><span>✦</span>{toast}<button type="button" onClick={() => setToast(undefined)} aria-label="Cerrar aviso">×</button></div>}
      <footer><span>BrowserMind Data</span><span>Todos los estados son locales y auditables · {session ? `última corrida ${session.metrics.elapsedMs}ms` : "sin corrida"}</span></footer>
    </main>
  );
}
