import { useEffect, useRef, useState } from "react";
import type { ModelAdapter } from "../core/escalation";
import { adapterForLevel } from "../core/models";
import { repairWithRetry, type RetryResult } from "../core/repairLoop";
import type { DiagnosticSession } from "../core/types";
import { attemptLabel, escalationView, metricsLabel, resultSummary } from "./escalationView";
import "./escalationPanel.css";

export interface EscalationPanelProps {
  session: DiagnosticSession;
  adapters: readonly ModelAdapter[];
  /** Notas del armado de modelos (modo replay, respaldo de nivel 2…). */
  notes?: readonly string[];
  /** Ejecuta el código parcheado (Pyodide) y devuelve el traceback si sigue fallando. */
  runPatched?: (code: string) => Promise<string | undefined>;
  maxAttempts?: number;
  tokenBudget?: number;
  /** Recibe la sesión final; el editor debe usar codeAfterRepair(result.session, code). */
  onResult: (result: RetryResult) => void;
  onError?: (message: string) => void;
}

/**
 * Escalamiento a un modelo de Meta con reintento verificado. Muestra qué viajó en cada
 * intento, por qué se rechazó y cuántos tokens costó. Se monta en lugar del botón de
 * escalar: `<EscalationPanel session={session} adapters={adapters} onResult={...} />`.
 */
export function EscalationPanel(props: EscalationPanelProps) {
  const { session, adapters, notes = [], runPatched, maxAttempts, tokenBudget, onResult, onError } = props;
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RetryResult>();
  const controller = useRef<AbortController | undefined>(undefined);
  const view = escalationView(session, adapters);

  // Una sesión nueva (otro análisis) descarta el resultado y cancela lo que esté en curso.
  useEffect(() => {
    setResult(undefined);
    return () => controller.current?.abort();
  }, [session.id]);

  async function repair(): Promise<void> {
    const adapter = adapterForLevel(adapters, session.escalation.level);
    if (!adapter) return;
    const current = new AbortController();
    controller.current = current;
    setRunning(true);
    try {
      const next = await repairWithRetry(session, adapter, { signal: current.signal, runPatched, maxAttempts, tokenBudget });
      if (current.signal.aborted) return;
      setResult(next);
      onResult(next);
    } catch (error) {
      if (!current.signal.aborted) onError?.(error instanceof Error ? error.message : String(error));
    } finally {
      if (controller.current === current) controller.current = undefined;
      setRunning(false);
    }
  }

  return (
    <section className="esc-panel" aria-label="Escalamiento a modelo">
      <div className="context-row">
        <div>
          <span className="label-muted">ESCALAMIENTO · NIVEL {view.level}</span>
          <strong>{view.model}{view.connected ? "" : " · no conectado"}</strong>
        </div>
        {view.canRepair && !result
          ? running
            ? <button type="button" className="button patch-button" onClick={() => controller.current?.abort()}>Cancelar<span>×</span></button>
            : <button type="button" className="button patch-button" onClick={repair}>Reparar con {view.model}<span>↗</span></button>
          : <code title={view.reason}>{metricsLabel(session)}</code>}
      </div>
      <p className="esc-reason">{view.reason}</p>
      {view.level > 0 && notes.map((note) => <p key={note} className="esc-note">{note}</p>)}
      {running && <p className="esc-note" role="status">Consultando el modelo y verificando el patch…</p>}
      {result && (
        <div className="esc-result">
          <strong className={result.stoppedBy === "verified" ? "esc-ok" : "esc-fail"}>{resultSummary(result)}</strong>
          <ol>
            {result.attempts.map((attempt) => (
              <li key={attempt.attempt}>
                <span>{attemptLabel(attempt)}</span>
                {attempt.patch && (
                  <div className="diff"><span className="removed">− {attempt.patch.before}</span><span className="added">+ {attempt.patch.after}</span></div>
                )}
                <details>
                  <summary>Contexto enviado en este intento</summary>
                  <pre>{attempt.payload}</pre>
                </details>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
