import {isPlatformBrowser} from '@angular/common';
import {Component, inject, PLATFORM_ID} from '@angular/core';
import {DomSanitizer} from '@angular/platform-browser';

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
        <img src="/img/plain.jpg" width="40" height="40" alt="" (load)="count('load')" />
        <video data-case="static" (canplay)="count('canplay')" src="clip.webm" autoplay muted loop playsinline preload="auto" width="320" height="180"></video>
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
    <h2>Iframes</h2>
    <p>Each document in an iframe counts how many times it loads, in <code>window.__frames</code>.</p>
    <iframe title="static src" src="frame.html?case=static" (load)="count('iframe-static')" width="160" height="60"></iframe>
    <iframe title="bound src" [src]="frame" (load)="count('iframe-bound')" width="160" height="60"></iframe>
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
  /** Handler calls, read by `bench/events.mjs`. */
  protected count(name: string) {
    const w = window as unknown as {__handlers?: Record<string, number>};
    w.__handlers = {...w.__handlers, [name]: (w.__handlers?.[name] ?? 0) + 1};
  }

  protected readonly clip = 'clip.webm';
  protected readonly frame = inject(DomSanitizer).bypassSecurityTrustResourceUrl('frame.html?case=bound');
  protected readonly platform = isPlatformBrowser(inject(PLATFORM_ID)) ? 'browser' : 'server';
  protected readonly platformClip = `clip.webm?rendered-on=${this.platform}`;
}
