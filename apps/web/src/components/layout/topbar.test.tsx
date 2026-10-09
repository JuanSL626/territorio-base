import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Topbar } from './topbar';

function renderTopbar(hasAoi: boolean) {
  return renderToStaticMarkup(
    <Topbar
      theme="topografia"
      vistas={[]}
      onThemeChange={() => undefined}
      compactVistas
      hasAoi={hasAoi}
      areaHa={hasAoi ? 12 : null}
      analysisReady={hasAoi}
      onAoiAction={() => undefined}
      onReport={() => undefined}
      onExport={() => undefined}
      exportJob={null}
    />,
  );
}

describe('Topbar', () => {
  it('shows a direct reset button only when an AOI exists', () => {
    expect(renderTopbar(true)).toContain('aria-label="Eliminar AOI y reiniciar análisis"');
    expect(renderTopbar(false)).not.toContain('aria-label="Eliminar AOI y reiniciar análisis"');
  });
});
