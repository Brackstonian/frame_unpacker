// Logging
const logContainer = document.getElementById('comments');
const log = text => {
    if (logContainer) {
        logContainer.innerHTML += text + '\n';
    } else {
        console.log(text);
    }
};

// Loading indicator (optional utility)
const startProgress = () => {
    document.documentElement.classList.add('cursor-loading');
};
const stopProgress = () => {
    document.documentElement.classList.remove('cursor-loading');
};

// average over an array
const average = arr => {
    return (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2);
};

// promise with timeout
const withTimeout = async (promise, timeout) => {
    return new Promise(async (resolve, reject) => {
        setTimeout(() => {
            reject(`Promise ${promise} timed out at ${timeout}ms`);
        }, timeout);
        await promise;
        resolve(promise);
    });
};

const FrameUnpacker = (() => {
    const waitForCanPlayThrough = async videoElement => {
        return new Promise(resolve => {
            const handler = () => {
                videoElement.removeEventListener('canplaythrough', handler);
                resolve();
            };
            videoElement.addEventListener('canplaythrough', handler);
        });
    };

    const waitForSeeked = async videoElement => {
        return new Promise(resolve => {
            const handler = () => {
                videoElement.removeEventListener('seeked', handler);
                resolve();
            };
            videoElement.addEventListener('seeked', handler);
        });
    };

    const getCanvasWebPBlob = async (canvasElement, quality) => {
        return new Promise((resolve) => {
            canvasElement.toBlob(
                (blob) => {
                    resolve(blob);
                },
                'image/webp',
                quality
            );
        });
    };

    // This function unpacks frames from the video
    const unpack = async (options) => {
        const {
            url,
            by,
            count,
            progress,
            quality,
            dimensionSource,
            customWidth,
            customHeight,
            scaleFactor,
            mobileMaxWidth
        } = options;

        const frames = [];

        // Create a video element & load source
        const videoElement = document.createElement('video');
        videoElement.crossOrigin = 'Anonymous';
        videoElement.muted = true; // important for autoplay in some browsers

        const sourceElement = document.createElement('source');
        sourceElement.type = 'video/webm';
        sourceElement.src = url;
        videoElement.appendChild(sourceElement);

        // Wait until canplaythrough (with 3s timeout)
        await withTimeout(waitForCanPlayThrough(videoElement), 3000);

        // Basic video info
        const duration = videoElement.duration;
        const nativeWidth = videoElement.videoWidth;
        const nativeHeight = videoElement.videoHeight;

        // Determine time stepping
        let timeStep, frameTotal;
        if (by === 'rate') {
            timeStep = 1 / count;  // e.g. if count=30 => every 1/30 = 0.0333s
            frameTotal = Infinity;
        } else if (by === 'count') {
            // If you re-enable this logic
            timeStep = duration / count;
            frameTotal = count;
        } else {
            throw new Error('Invalid extract-by mode');
        }

        // Seek to 0
        videoElement.currentTime = 0;
        await waitForSeeked(videoElement);

        // Decide final output width & height
        let outputWidth = nativeWidth;
        let outputHeight = nativeHeight;

        if (dimensionSource === 'original') {
            // Just use nativeWidth/nativeHeight
            outputWidth = nativeWidth;
            outputHeight = nativeHeight;
        }
        else if (dimensionSource === 'custom') {
            // Use user-supplied custom dimensions
            outputWidth = customWidth;
            outputHeight = customHeight;
        }
        else if (dimensionSource === 'scale') {
            // Scale factor approach
            // e.g. factor=0.5 => half the size
            outputWidth = Math.round(nativeWidth * scaleFactor);
            outputHeight = Math.round(nativeHeight * scaleFactor);
        }
        else if (dimensionSource === 'mobile') {
            // Mobile approach: scale down to 'mobileMaxWidth' if needed
            // preserve aspect ratio
            if (nativeWidth > mobileMaxWidth) {
                const ratio = nativeHeight / nativeWidth;
                outputWidth = mobileMaxWidth;
                outputHeight = Math.round(mobileMaxWidth * ratio);
            } else {
                // If the original is already smaller, no scaling
                outputWidth = nativeWidth;
                outputHeight = nativeHeight;
            }
        }

        // Create an offscreen canvas
        const canvasElement = document.createElement('canvas');
        canvasElement.width = outputWidth;
        canvasElement.height = outputHeight;
        const context = canvasElement.getContext('2d');

        // We'll track timings to compute average frame extraction time
        const frameExtractTimings = [];

        let frameCount = 0;
        for (let step = 0; step <= duration && frameCount < frameTotal; step += timeStep) {
            videoElement.currentTime = step;
            await waitForSeeked(videoElement); // ensure video is actually at that frame

            context.clearRect(0, 0, outputWidth, outputHeight);

            const t0 = performance.now();
            // Draw the current video frame into the canvas
            context.drawImage(
                videoElement,
                0, 0, nativeWidth, nativeHeight, // source rect
                0, 0, outputWidth, outputHeight  // destination rect
            );
            // Convert to blob
            const imageDataBlob = await getCanvasWebPBlob(canvasElement, parseFloat(quality));
            frameExtractTimings.push(performance.now() - t0);

            frames.push(imageDataBlob);
            frameCount++;

            // Update progress bar
            progress(Math.ceil((step / duration) * 100));
        }

        return {
            frames: frames,
            meta: {
                count: frames.length,
                avgTime: average(frameExtractTimings),
                finalWidth: outputWidth,
                finalHeight: outputHeight
            }
        };
    };

    return {
        unpack
    };
})();

(async () => {
    const formElement = document.getElementById('video-form');
    const framesProgress = document.getElementById('frames-progress');

    // Dimension UI elements
    const dimensionsSelect = document.getElementById('dimensions-source');
    const customDimensionsContainer = document.getElementById('custom-dimensions-container');
    const scaleContainer = document.getElementById('scale-container');
    const mobilePresetsContainer = document.getElementById('mobile-presets-container');

    // Show/hide relevant dimension controls
    dimensionsSelect.addEventListener('change', () => {
        const choice = dimensionsSelect.value;
        customDimensionsContainer.style.display = (choice === 'custom') ? 'block' : 'none';
        scaleContainer.style.display = (choice === 'scale') ? 'block' : 'none';
        mobilePresetsContainer.style.display = (choice === 'mobile') ? 'block' : 'none';
    });

    const disableInput = () => {
        formElement.style.pointerEvents = 'none';
        formElement.style.opacity = 0.5;
    };
    const enableInput = () => {
        formElement.style.pointerEvents = '';
        formElement.style.opacity = 1;
    };
    const updateProgress = (progressElement, value) => {
        progressElement.value = value;
    };

    // Gather & validate form data
    const getValidatedFormData = () => {
        const fileEl = document.getElementById('video-file');
        const extractByEl = document.getElementById('extract-by');
        const extractCountEl = document.getElementById('extract-count');
        const extractQualityEl = document.getElementById('extract-quality');

        if (!fileEl || !extractByEl || !extractCountEl || !extractQualityEl) {
            throw new Error('Required input elements are missing!');
        }
        if (!fileEl.files || fileEl.files.length !== 1) {
            throw new Error('No valid video file selected!');
        }

        // Validate "extract by" and "extract count"
        const extractBy = extractByEl.value;
        const extractCount = parseInt(extractCountEl.value, 10);
        if (extractBy === 'rate') {
            if (extractCount < 1 || extractCount > 60) {
                throw new Error('Frame rate must be between 1 and 60.');
            }
        } else if (extractBy === 'count') {
            // If you re-enable the “count” option,
            // we might allow 1 -> 3600 frames, for example.
        }

        const extractQuality = parseFloat(extractQualityEl.value);
        if (extractQuality < 0.01 || extractQuality > 1) {
            throw new Error('Quality must be between 0.01 and 1.');
        }

        // Dimension logic
        const dimensionSource = dimensionsSelect.value;
        let customWidth = null, customHeight = null;
        let scaleFactor = 1.0;
        let mobileMaxWidth = 720; // default

        if (dimensionSource === 'custom') {
            const wEl = document.getElementById('custom-width');
            const hEl = document.getElementById('custom-height');
            customWidth = parseInt(wEl.value, 10);
            customHeight = parseInt(hEl.value, 10);
            if (isNaN(customWidth) || isNaN(customHeight) ||
                customWidth < 1 || customHeight < 1) {
                throw new Error('Custom width/height must be positive integers.');
            }
        }
        else if (dimensionSource === 'scale') {
            const sfEl = document.getElementById('scale-factor');
            scaleFactor = parseFloat(sfEl.value);
            if (isNaN(scaleFactor) || scaleFactor <= 0) {
                throw new Error('Scale factor must be > 0.');
            }
        }
        else if (dimensionSource === 'mobile') {
            const mSelect = document.getElementById('mobile-width-preset');
            mobileMaxWidth = parseInt(mSelect.value, 10);
        }

        return {
            videoFile: fileEl.files[0],
            extractBy,
            extractCount,
            extractQuality,
            dimensionSource,
            customWidth,
            customHeight,
            scaleFactor,
            mobileMaxWidth
        };
    };

    const loadVideoFile = async file => {
        return new Promise(resolve => {
            const fr = new FileReader();
            fr.onloadend = e => {
                resolve(e.target.result);
            };
            fr.readAsDataURL(file);
        });
    };

    // Extract frames with the FrameUnpacker
    const extractFrames = async () => {
        log('Validating inputs...');
        const formData = getValidatedFormData();

        log(`Loading video...`);
        const videoDataURI = await loadVideoFile(formData.videoFile);

        log('Extracting frames. This might take a while...');
        const unpacked = await FrameUnpacker.unpack({
            url: videoDataURI,
            by: formData.extractBy,
            count: formData.extractCount,
            quality: formData.extractQuality,
            dimensionSource: formData.dimensionSource,
            customWidth: formData.customWidth,
            customHeight: formData.customHeight,
            scaleFactor: formData.scaleFactor,
            mobileMaxWidth: formData.mobileMaxWidth,
            progress: value => {
                updateProgress(framesProgress, value);
            }
        });

        log(`Total frames extracted: ${unpacked.meta.count}`);
        log(`Average extraction time per frame: ${unpacked.meta.avgTime} ms`);
        log(`Final frame dimension: ${unpacked.meta.finalWidth} x ${unpacked.meta.finalHeight}`);

        return unpacked.frames;
    };

    // Zip and download frames as .webp
    const zipAndDownload = async (fileBlobs, fileNamePattern, zipFileName) => {
        log('Creating zip file with frames. Please wait...');
        const zip = new JSZip();
        const padCount = fileBlobs.length.toString().length;

        fileBlobs.forEach((fileBlob, i) => {
            const fileIndex = (i + 1).toString().padStart(padCount, '0');
            zip.file(fileNamePattern.replace('{{id}}', fileIndex), fileBlob);
        });

        zip.generateAsync({ type: 'blob' }).then(zipContent => {
            log('Triggering zip download...');
            saveAs(zipContent, zipFileName + '.zip');
            log('Done!');
        });
    };

    // Form submission
    formElement.addEventListener('submit', async e => {
        e.preventDefault();

        try {
            disableInput();
            updateProgress(framesProgress, 0);

            const frames = await extractFrames();
            await zipAndDownload(frames, 'frame-{{id}}.webp', 'extracted-frames-webp');

        } catch (err) {
            log(err);
        } finally {
            enableInput();
            updateProgress(framesProgress, 0);
        }
    });
})();
