import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  FileImage,
  ImagePlus,
  LoaderCircle,
  Menu,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { enhanceImage, getBackendHealth } from './api';
import type { BackendHealth } from './api';
import { formatBytes, inspectImage, outputSizeError } from './validation';
import type { ImageDetails } from './validation';

type SelectedImage = ImageDetails & { previewUrl: string };
type ProcessedImage = { url: string; width: number | null; height: number | null };
type EnhancementMode = 'photo' | 'illustration';

const samplePhoto = 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1500&q=85';
const repositoryUrl = (import.meta.env.VITE_GITHUB_REPOSITORY_URL as string | undefined)?.trim();

function ComparisonView({
  before,
  after,
  value,
  onChange,
  beforeLabel = 'Original',
  afterLabel = 'Enhanced',
  illustrative = false,
}: {
  before: string;
  after: string;
  value: number;
  onChange: (value: number) => void;
  beforeLabel?: string;
  afterLabel?: string;
  illustrative?: boolean;
}) {
  return (
    <div className={`compare-view${illustrative ? ' compare-view--sample' : ''}`}>
      <img className="compare-image" src={before} alt={`${beforeLabel} image`} />
      <div className="compare-after" style={{ clipPath: `inset(0 0 0 ${value}%)` }}>
        <img className="compare-image" src={after} alt={`${afterLabel} image`} />
      </div>
      <span className="compare-label compare-label--before">{beforeLabel}</span>
      <span className="compare-label compare-label--after">{afterLabel}</span>
      <span className="compare-divider" style={{ left: `${value}%` }} aria-hidden="true">
        <span><ArrowRight size={13} /><ArrowRight size={13} /></span>
      </span>
      <input
        className="compare-range"
        aria-label="Move the comparison divider"
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="section-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<SelectedImage | null>(null);
  const [processed, setProcessed] = useState<ProcessedImage | null>(null);
  const [scale, setScale] = useState(2);
  const [mode, setMode] = useState<EnhancementMode>('photo');
  const [comparison, setComparison] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [backend, setBackend] = useState<BackendHealth | null>(null);
  const [healthChecked, setHealthChecked] = useState(false);

  useEffect(() => {
    let active = true;
    getBackendHealth()
      .then((health) => {
        if (active) setBackend(health);
      })
      .catch(() => {
        if (active) setBackend(null);
      })
      .finally(() => {
        if (active) setHealthChecked(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    if (selected) URL.revokeObjectURL(selected.previewUrl);
  }, [selected]);

  useEffect(() => () => {
    if (processed) URL.revokeObjectURL(processed.url);
  }, [processed]);

  const sizeError = selected ? outputSizeError(selected.width, selected.height, scale) : null;
  const modelReady = mode === 'photo'
    ? backend?.models[`photo_${scale}x`]?.ready ?? false
    : backend?.models.illustration_4x?.ready ?? false;
  const backendStatus = !healthChecked
    ? 'Preparing AI options'
    : backend?.status === 'browser'
      ? 'Browser AI ready'
      : backend?.inference_available
        ? 'AI service ready'
        : backend
          ? 'Model setup needed'
          : 'AI service offline';

  async function acceptFile(file?: File) {
    if (!file) return;
    setError(null);
    try {
      const details = await inspectImage(file);
      const previewUrl = URL.createObjectURL(file);
      setSelected({ ...details, previewUrl });
      setProcessed(null);
      setComparison(50);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This image could not be opened.');
    }
  }

  function resetWorkspace() {
    setSelected(null);
    setProcessed(null);
    setError(null);
    setScale(2);
    setMode('photo');
    setComparison(50);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function runEnhancement() {
    if (!selected || processing || sizeError) return;
    setProcessing(true);
    setError(null);
    setProcessed(null);
    try {
      const output = await enhanceImage(selected.file, scale, mode);
      const url = URL.createObjectURL(output.image);
      setProcessed({ url, width: output.width, height: output.height });
      setComparison(50);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Enhancement failed. Please try again.');
    } finally {
      setProcessing(false);
    }
  }

  function setEnhancementMode(nextMode: EnhancementMode) {
    setMode(nextMode);
    if (nextMode === 'illustration') setScale(4);
  }

  const navLinks = [
    ['Upscaler', '#upscaler'],
    ['Features', '#features'],
    ['How it works', '#how-it-works'],
    ['About', '#about'],
  ];

  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="PixPic home">
          <span className="brand-mark"><span /><span /><span /><span /></span>
          <span>pixpic<span className="brand-period">.</span></span>
        </a>
        <nav className={`main-nav${mobileMenuOpen ? ' main-nav--open' : ''}`} aria-label="Main navigation">
          {navLinks.map(([label, href]) => (
            <a key={href} href={href} onClick={() => setMobileMenuOpen(false)}>{label}</a>
          ))}
          <a className="mobile-nav-action" href="#upscaler" onClick={() => setMobileMenuOpen(false)}>Upscale an image <ArrowUpRight size={15} /></a>
        </nav>
        <a className="button button--dark header-action" href="#upscaler">Upscale image <ArrowUpRight size={15} /></a>
        <button className="icon-button menu-toggle" type="button" aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      <main id="top">
        <section className="hero-section">
          <div className="hero-copy">
            <span className="eyebrow"><span className="eyebrow-dot" /> A little more detail changes everything</span>
            <h1>Make every<br /><span>pixel count.</span></h1>
            <p className="hero-description">Enhance image quality with AI-powered upscaling. Bring clarity and detail back to the photos worth keeping.</p>
            <div className="hero-actions">
              <a className="button button--accent" href="#upscaler"><ImagePlus size={17} /> Upload image</a>
              <a className="text-link" href="#how-it-works">See how it works <ArrowRight size={16} /></a>
            </div>
            <div className="hero-footnote"><ShieldCheck size={15} /> Your images are processed without being stored.</div>
          </div>
          <div className="hero-art" aria-label="Illustrative before and after landscape comparison">
            <div className="hero-photo-wrap">
              <ComparisonView
                before={samplePhoto}
                after={samplePhoto}
                value={comparison}
                onChange={setComparison}
                beforeLabel="BEFORE"
                afterLabel="DETAIL PREVIEW"
                illustrative
              />
              <div className="sample-stamp"><Sparkles size={14} /> A clearer view</div>
            </div>
            <div className="sample-caption"><span>Drag to compare</span><span>Illustrative preview</span></div>
            <div className="hero-orbit hero-orbit--one" aria-hidden="true" />
            <div className="hero-orbit hero-orbit--two" aria-hidden="true" />
          </div>
        </section>

        <section className="trust-strip" aria-label="PixPic service details">
          <span><Zap size={16} /> AI-powered enhancement</span>
          <span><ShieldCheck size={16} /> No image storage</span>
          <span><FileImage size={16} /> JPG and PNG</span>
          <span><ScanSearch size={16} /> 2× and 4× output</span>
        </section>

        <section className="workspace-section" id="upscaler">
          <div className="workspace-intro">
            <div>
              <span className="eyebrow">THE UPSCALER</span>
              <h2>Give your image room to shine.</h2>
              <p>Choose an image and let the details come through.</p>
            </div>
            <div className={`service-state${backend?.inference_available ? ' service-state--ready' : ''}`} aria-live="polite">
              <span className="service-indicator" /> {backendStatus}
              <span className="service-hint" title={backend?.status === 'browser' ? 'Free ESRGAN model runs locally in your browser after downloading from the public CDN.' : modelReady ? 'The selected model and its weights are available.' : 'Image enhancement needs a running backend with the selected Real-ESRGAN model weights.'}><CircleHelp size={14} /></span>
            </div>
          </div>

          <div className="workspace-grid">
            <div className="workspace-panel upload-panel">
              <div className="panel-heading">
                <div><span className="panel-index">01</span><h3>Your image</h3></div>
                {selected && <button className="quiet-button" type="button" onClick={resetWorkspace}><RefreshCw size={14} /> Start over</button>}
              </div>
              <input
                ref={fileInput}
                className="visually-hidden"
                type="file"
                accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                aria-label="Choose a JPG or PNG image"
                onChange={(event) => void acceptFile(event.target.files?.[0])}
              />
              {!selected ? (
                <div
                  className={`drop-zone${dragging ? ' drop-zone--active' : ''}`}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => { event.preventDefault(); setDragging(false); void acceptFile(event.dataTransfer.files[0]); }}
                >
                  <div className="upload-symbol"><Upload size={22} /></div>
                  <strong>Drop your image here</strong>
                  <span>or choose a file from your device</span>
                  <button className="button button--outline" type="button" onClick={() => fileInput.current?.click()}>Browse files</button>
                  <small>JPG, JPEG, PNG <i /> Up to 12 MB</small>
                </div>
              ) : (
                <div className="selected-image">
                  <div className="selected-preview">
                    <img src={selected.previewUrl} alt={`Selected image: ${selected.file.name}`} />
                    <button className="remove-image" type="button" aria-label="Remove selected image" onClick={resetWorkspace}><X size={16} /></button>
                  </div>
                  <div className="file-details">
                    <div className="file-icon"><FileImage size={18} /></div>
                    <div className="file-name"><strong title={selected.file.name}>{selected.file.name}</strong><span>{selected.width.toLocaleString()} × {selected.height.toLocaleString()} px · {formatBytes(selected.size)}</span></div>
                    <Check className="file-check" size={17} />
                  </div>
                  <button className="replace-link" type="button" onClick={() => fileInput.current?.click()}>Replace image <ArrowUpRight size={14} /></button>
                </div>
              )}
              <div className="privacy-note"><ShieldCheck size={15} /> {backend?.status === 'browser' ? 'Images stay on your device; AI inference runs in your browser.' : 'Images are sent to the configured AI backend only when you select Enhance.'}</div>
            </div>

            <div className="workspace-panel settings-panel">
              <div className="panel-heading">
                <div><span className="panel-index">02</span><h3>Enhancement</h3></div>
              </div>
              <label className="field-label" htmlFor="mode-select">Image type</label>
              <div className="select-wrap">
                <select id="mode-select" value={mode} onChange={(event) => setEnhancementMode(event.target.value as EnhancementMode)}>
                  <option value="photo">Photo · Real-ESRGAN</option>
                  <option value="illustration">Illustration · ESRGAN Medium 4×</option>
                </select>
                <ChevronDown size={16} aria-hidden="true" />
              </div>
              <span className="field-caption">{mode === 'photo' ? 'AI detail recovery for photographs, processed on your device.' : 'General-purpose ESRGAN 4× enhancement for artwork and illustrations.'}</span>

              <span className="field-label scale-label">Upscale factor</span>
              <div className="scale-options" role="group" aria-label="Upscale factor">
                {[2, 4].map((factor) => (
                  <button
                    key={factor}
                    type="button"
                    className={`scale-option${scale === factor ? ' scale-option--selected' : ''}`}
                    aria-pressed={scale === factor}
                    disabled={mode === 'illustration' && factor === 2}
                    onClick={() => setScale(factor)}
                  >
                    <span className="scale-number">{factor}×</span>
                    <span>{factor === 2 ? '2× larger' : '4× larger'}</span>
                    {scale === factor && <Check size={15} />}
                  </button>
                ))}
              </div>

              <button className="advanced-toggle" type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(!advancedOpen)}>
                Advanced settings <ChevronDown size={15} className={advancedOpen ? 'chevron-rotated' : ''} />
              </button>
              {advancedOpen && (
                <div className="advanced-content">
                  <span className="advanced-dot" />
                  <div><strong>Model-managed refinement</strong><p>Noise reduction and detail recovery are handled by the selected Real-ESRGAN model.</p></div>
                </div>
              )}

              {sizeError && <p className="inline-warning" role="status">{sizeError}</p>}
              {!sizeError && selected && !modelReady && (
                <p className="inline-warning" role="status">
                  {backend ? 'The selected model is not ready. Check the backend model setup before enhancing.' : 'Connect the PixPic AI backend to process this image.'}
                </p>
              )}
              <button className="button button--enhance" type="button" disabled={!selected || processing || Boolean(sizeError)} onClick={() => void runEnhancement()}>
                {processing ? <><LoaderCircle className="spin" size={17} /> Enhancing image…</> : <><Sparkles size={17} /> Enhance image <ArrowRight size={17} /></>}
              </button>
              <div className="service-footnote">Real AI inference · No resizing fallback</div>
            </div>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <div>
                <CircleHelp size={18} />
                <div>
                  <p>{error}</p>
                  <a className="text-link" href="https://huggingface.co/spaces/gokaygokay/AuraSR" target="_blank" rel="noreferrer">
                    Try the free Hugging Face upscaler <ArrowUpRight size={14} />
                  </a>
                  <small className="error-privacy-note">This opens a third-party demo. Images you upload there are sent to that service.</small>
                </div>
              </div>
              {selected && !processing && <button type="button" onClick={() => void runEnhancement()}><RefreshCw size={14} /> Try again</button>}
              <button className="error-dismiss" type="button" aria-label="Dismiss message" onClick={() => setError(null)}><X size={16} /></button>
            </div>
          )}

          {processing && (
            <div className="processing-panel" role="status" aria-live="polite">
              <div className="processing-icon"><LoaderCircle className="spin" size={22} /></div>
              <div><strong>Finding the details.</strong><p>Real-ESRGAN is working on your image. Larger images can take a little longer.</p></div>
              <span className="processing-factor">{scale}× · {mode === 'photo' ? 'Photo' : 'Illustration'}</span>
            </div>
          )}

          {processed && selected && (
            <section className="result-panel" aria-labelledby="result-title">
              <div className="result-heading">
                <div><span className="eyebrow">03 · READY TO DOWNLOAD</span><h3 id="result-title">A little more detail.</h3></div>
                <a className="button button--accent" href={processed.url} download={`pixpic-${scale}x-${selected.file.name.replace(/\.[^.]+$/, '')}.png`}><ArrowDownToLine size={17} /> Download PNG</a>
              </div>
              <ComparisonView before={selected.previewUrl} after={processed.url} value={comparison} onChange={setComparison} />
              <div className="result-meta">
                <div><span>Original</span><strong>{selected.width.toLocaleString()} × {selected.height.toLocaleString()} px</strong></div>
                <ArrowRight size={16} />
                <div><span>Enhanced · {scale}×</span><strong>{processed.width && processed.height ? `${processed.width.toLocaleString()} × ${processed.height.toLocaleString()} px` : `${(selected.width * scale).toLocaleString()} × ${(selected.height * scale).toLocaleString()} px`}</strong></div>
                <button className="quiet-button result-reset" type="button" onClick={resetWorkspace}><ImagePlus size={15} /> Enhance another image</button>
              </div>
            </section>
          )}
        </section>

        <section className="features-section" id="features">
          <div className="features-topline"><span className="eyebrow">DETAIL, WITH INTENTION</span><span className="features-aside">Made for the images you want to keep.</span></div>
          <SectionHeading eyebrow="WHAT PIXPIC DOES" title="More than a bigger image.">A careful enhancement pass, powered by a real super-resolution model.</SectionHeading>
          <div className="feature-grid">
            <article className="feature-item"><span className="feature-icon feature-icon--mint"><Sparkles size={20} /></span><h3>Reconstructed detail</h3><p>Real-ESRGAN infers finer image detail instead of simply stretching existing pixels.</p></article>
            <article className="feature-item"><span className="feature-icon feature-icon--coral"><ScanSearch size={20} /></span><h3>Cleaner edges</h3><p>Designed to recover sharpness and reduce compression artifacts in supported images.</p></article>
            <article className="feature-item"><span className="feature-icon feature-icon--yellow"><Zap size={20} /></span><h3>Just the essentials</h3><p>Upload, choose a factor, preview the result, and download when it looks right.</p></article>
            <article className="feature-item"><span className="feature-icon feature-icon--blue"><ShieldCheck size={20} /></span><h3>Private by default</h3><p>PixPic does not keep a copy. The configured backend handles each image in memory.</p></article>
          </div>
        </section>

        <section className="how-section" id="how-it-works">
          <div className="how-copy"><span className="eyebrow">NO DETOURS</span><h2>From small to<br />standout in four steps.</h2><p>A straightforward workflow, with a real model doing the heavy lifting.</p><a className="text-link" href="#upscaler">Try the upscaler <ArrowRight size={16} /></a></div>
          <div className="steps-list">
            <article className="step-item"><span className="step-number">01</span><div><h3>Choose an image</h3><p>Upload a JPG or PNG from your device.</p></div><Upload size={19} /></article>
            <article className="step-item"><span className="step-number">02</span><div><h3>Set your scale</h3><p>Choose 2× or 4× and the right image model.</p></div><ScanSearch size={19} /></article>
            <article className="step-item"><span className="step-number">03</span><div><h3>Preview the result</h3><p>Compare the source and enhanced versions.</p></div><Sparkles size={19} /></article>
            <article className="step-item"><span className="step-number">04</span><div><h3>Save your image</h3><p>Download the processed PNG to your device.</p></div><ArrowDownToLine size={19} /></article>
          </div>
        </section>

        <section className="about-strip" id="about"><span className="about-mark"><span className="brand-mark"><span /><span /><span /><span /></span></span><div><span className="eyebrow">A SMALL TOOL FOR A BIG DIFFERENCE</span><p>PixPic is an independent image-enhancement interface. AI processing is provided by your configured PixPic backend using open-source Real-ESRGAN models.</p></div><a href="#upscaler" aria-label="Go to the PixPic upscaler"><ArrowUpRight size={19} /></a></section>
      </main>

      <footer className="site-footer">
        <a className="brand footer-brand" href="#top"><span className="brand-mark"><span /><span /><span /><span /></span><span>pixpic<span className="brand-period">.</span></span></a>
        <span className="footer-copy">Make every pixel count.</span>
        <nav className="footer-links" aria-label="Footer navigation">
          <a href="#upscaler">Upscaler</a><a href="#features">Features</a><a href="#how-it-works">How it works</a>
          {repositoryUrl && <a href={repositoryUrl} target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={12} /></a>}
          <span title="A privacy policy will be published with the hosted service.">Privacy policy <small>(not yet published)</small></span>
        </nav>
      </footer>
    </div>
  );
}

export default App;
