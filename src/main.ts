import {bootstrapApplication} from '@angular/platform-browser';
import {App} from './app/app';
import {appConfig} from './app/app.config';
import {benchHooks} from './bench-hooks';

// `?bootAfterLoad` delays hydration until the window `load` event, i.e. until the above-the-fold
// images have finished loading (like a repeat visit with cached images, or a slow JS bundle).
// `?bootDelay=<ms>` additionally waits that long (e.g. so autoplaying media is already playing).
const params = new URLSearchParams(location.search);
const waitForImages =
  params.has('bootAfterLoad') && document.readyState !== 'complete'
    ? new Promise((resolve) => addEventListener('load', resolve, {once: true}))
    : Promise.resolve();
const bootDelay = Number(params.get('bootDelay') ?? 0);

waitForImages
  .then(() => new Promise((resolve) => setTimeout(resolve, bootDelay)))
  .then(() => {
    benchHooks()?.onBootstrapStart();
    return bootstrapApplication(App, appConfig);
  })
  .then(async (appRef) => {
    await appRef.whenStable();
    benchHooks()?.onAppStable();
  })
  .catch((err) => console.error(err));
