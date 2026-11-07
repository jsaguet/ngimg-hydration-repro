import {IMAGE_LOADER, ImageLoaderConfig} from '@angular/common';
import {ApplicationConfig, provideBrowserGlobalErrorListeners} from '@angular/core';
import {provideClientHydration} from '@angular/platform-browser';
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

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(),
    {provide: IMAGE_LOADER, useValue: imgixLikeLoader},
  ],
};
