import {isPlatformBrowser} from '@angular/common';
import {Component, inject, PLATFORM_ID} from '@angular/core';

/**
 * Three autoplaying videos with the same clip, one per way of putting `src` on the element:
 * a static attribute (written by core from the template), a property binding and an attribute
 * binding (both written by core's binding instructions). Used to check whether hydration
 * restarts media that is already playing.
 */
@Component({
  selector: 'app-media-page',
  template: `
    <h1>Media during hydration</h1>
    <ul class="videos">
      <li>
        <span>static <code>src="…"</code></span>
        <video data-case="static" src="clip.wav" autoplay muted loop playsinline preload="auto" width="240" height="40"></video>
      </li>
      <li>
        <span>property binding <code>[src]</code></span>
        <video data-case="property binding" [src]="clip" autoplay muted loop playsinline preload="auto" width="240" height="40"></video>
      </li>
      <li>
        <span>attribute binding <code>[attr.src]</code></span>
        <video data-case="attribute binding" [attr.src]="clip" autoplay muted loop playsinline preload="auto" width="240" height="40"></video>
      </li>
      <li>
        <!-- Control: the browser computes different values than the server, so they must be written. -->
        <span>client value ≠ server value</span>
        <video data-case="client differs" [src]="platformClip" [attr.data-platform]="platform" [title]="platform"
          autoplay muted loop playsinline preload="auto" width="240" height="40"></video>
      </li>
    </ul>
  `,
  styles: `
    :host { display: block; max-width: 960px; margin: 0 auto; padding: 16px; }
    .videos { list-style: none; padding: 0; display: grid; gap: 8px; }
    li { display: flex; gap: 12px; align-items: center; }
    span { width: 220px; }
    video { background: var(--line); }
  `,
})
export class MediaPage {
  protected readonly clip = 'clip.wav';
  protected readonly platform = isPlatformBrowser(inject(PLATFORM_ID)) ? 'browser' : 'server';
  protected readonly platformClip = `clip.wav?rendered-on=${this.platform}`;
}
