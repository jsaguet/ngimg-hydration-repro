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
    <h1>Videos during hydration</h1>
    <p>Open with <code>?bootAfterLoad&amp;bootDelay=3000</code> to start hydration 3 s after load. The timer in a video jumps back to 0 if hydration restarts it.</p>
    <ul class="videos">
      <li>
        <span>static <code>src="…"</code></span>
        <small class="status"></small>
        <video data-case="static" src="clip.webm" autoplay muted loop playsinline preload="auto" width="320" height="180"></video>
      </li>
      <li>
        <span>property binding <code>[src]</code></span>
        <small class="status"></small>
        <video data-case="property binding" [src]="clip" autoplay muted loop playsinline preload="auto" width="320" height="180"></video>
      </li>
      <li>
        <span>attribute binding <code>[attr.src]</code></span>
        <small class="status"></small>
        <video data-case="attribute binding" [attr.src]="clip" autoplay muted loop playsinline preload="auto" width="320" height="180"></video>
      </li>
      <li>
        <!-- Control: the browser computes different values than the server, so they must be written. -->
        <span>control: <code>src</code> differs between server and browser, so this video must restart</span>
        <small class="status"></small>
        <video data-case="client differs" [src]="platformClip" [attr.data-platform]="platform" [title]="platform"
          autoplay muted loop playsinline preload="auto" width="320" height="180"></video>
      </li>
    </ul>
  `,
  styles: `
    :host { display: block; max-width: 960px; margin: 0 auto; padding: 16px; }
    .videos { list-style: none; padding: 0; display: grid; gap: 8px; }
    li { display: flex; gap: 12px; align-items: center; }
    span { width: 220px; } li[data-restarted] .status::after { content: 'Restarted during hydration'; color: var(--bad); font-weight: 600; }
    video { background: var(--line); }
  `,
})
export class MediaPage {
  protected readonly clip = 'clip.webm';
  protected readonly platform = isPlatformBrowser(inject(PLATFORM_ID)) ? 'browser' : 'server';
  protected readonly platformClip = `clip.webm?rendered-on=${this.platform}`;
}
