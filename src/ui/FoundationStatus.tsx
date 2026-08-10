import { releaseBoundary } from '../config/release-boundary.js';

const guarantees = [
  'Development services bind only to 127.0.0.1 inside ports 4210–4213.',
  'This release has no PDF-processing surface and makes no document-safety claim.',
  'No remote fonts, analytics, document uploads, or runtime network dependencies are present.',
] as const;

export function FoundationStatus() {
  const productionStatus = releaseBoundary.productionStatus.replaceAll('-', ' ');

  return (
    <main className="foundation" aria-labelledby="page-title">
      <div className="foundation__grid" aria-hidden="true" />
      <header className="foundation__masthead">
        <p className="foundation__eyebrow">Local forensic document tooling · foundation surface</p>
        <span className="foundation__state">{productionStatus}</span>
      </header>

      <section className="foundation__hero">
        <p className="foundation__index" aria-hidden="true">
          00 / 13
        </p>
        <div>
          <h1 id="page-title">Forensic PDF redaction verifier</h1>
          <p className="foundation__lede">
            The executable contract is online. Document inspection, repair, and verification are not
            available in this foundation release.
          </p>
        </div>
      </section>

      <section className="foundation__notice" aria-labelledby="release-boundary">
        <div className="foundation__rule" aria-hidden="true" />
        <div>
          <p className="foundation__label">Current release boundary</p>
          <h2 id="release-boundary">Refuses to imply safety before the verifier exists.</h2>
        </div>
        <ol>
          {guarantees.map((guarantee, index) => (
            <li key={guarantee}>
              <span className="foundation__notice-index" aria-hidden="true">
                0{index + 1}
              </span>
              <span>{guarantee}</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="foundation__footer">
        <span>Repository contract active</span>
        <span>Zero document bytes accepted</span>
      </footer>
    </main>
  );
}
