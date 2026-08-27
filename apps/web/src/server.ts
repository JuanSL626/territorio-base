import {
  createStartHandler,
  defaultStreamHandler,
  type RequestHandler,
} from '@tanstack/react-start/server';

import type { Register } from '@tanstack/react-router';

const fetch: RequestHandler<Register> = createStartHandler(defaultStreamHandler);

export default { fetch };
