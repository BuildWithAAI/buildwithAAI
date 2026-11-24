import type {RouteModule} from '../http.ts';
import * as go from './go.ts';
import * as studio from './studio.ts';
import * as subscribe from './subscribe.ts';
import * as pages from './pages.ts';
import * as admin from './admin.ts';

/** Every route module, registered in this order by the server core. */
export const routeModules: RouteModule[] = [go, studio, subscribe, pages, admin];
