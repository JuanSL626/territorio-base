import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SideDrawer } from './sheet';

describe('SideDrawer', () => {
  it('keeps tall touch content vertically scrollable', () => {
    const html = renderToStaticMarkup(
      <SideDrawer open onClose={() => undefined} title="Capas" side="left" width={340}>
        <div>Contenido</div>
      </SideDrawer>,
    );

    expect(html).toContain('min-h-0 flex-1 overflow-y-auto');
  });
});
