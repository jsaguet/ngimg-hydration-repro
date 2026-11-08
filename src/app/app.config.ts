import {IMAGE_LOADER, ImageLoaderConfig} from '@angular/common';
import {ApplicationConfig, provideBrowserGlobalErrorListeners} from '@angular/core';
import {provideClientHydration, withNoIncrementalHydration} from '@angular/platform-browser';
import {provideRouter} from '@angular/router';
import {routes} from './app.routes';

/**
 * Same URL shape as the built-in imgix loader (`provideImgixLoader`), but served by this app's
 * own server (see `/img/*` in server.ts) so the benchmark needs no network.
 */
function imgixLikeLoader(config: ImageLoaderConfig): string {
  const params = ['auto=format'];
  if (config.width) {
    params.push(`w=${config.width}`);
  }
  return `/img/${config.src}?${params.join('&')}`;
}

// `bench/events.mjs` turns off event replay with `NO_REPLAY=1` on the server and `?noReplay` in the browser.
const noEventReplay =
  typeof location !== 'undefined'
    ? location.search.includes('noReplay')
    : process.env['NO_REPLAY'] === '1';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(...(noEventReplay ? [withNoIncrementalHydration()] : [])),
    {provide: IMAGE_LOADER, useValue: imgixLikeLoader},
  ],
};
