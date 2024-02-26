// Logging
const logContainer = document.getElementById('comments');
const log = text => {
    if (logContainer) {
        logContainer.innerHTML += text + '\n';
    } else {
        console.log(text);
    }
};

// Loading indicator
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

    const getCanvasPNGBlob = async (canvasElement) => {
        return new Promise((resolve) => {
            canvasElement.toBlob(
                (blob) => {
                    resolve(blob);
                },
                'image/png',
                1 // quality parameter doesn't apply to PNG
            );
        });
    };

    const unpack = async options => {
        const videoUrl = options.url,
            by = options.by,
            count = options.count,
            progressHook = options.progress;

        const frames = [];

        // load the video video element
        const videoElement = document.createElement('video');
        videoElement.crossOrigin = 'Anonymous';
        videoElement.muted = true; // important for autoplay

        // Create a source element and add video url
        const sourceElement = document.createElement('source');
        //TODO: ENSURE THAT UPLOADED VIDEO TPYE HAS CORRECT SOURCE.
        sourceElement.type = 'video/webm';
        sourceElement.src = videoUrl;

        // Append the source element to the video element
        videoElement.appendChild(sourceElement);


        // wait for it to be ready for processing
        // also keep a timeout, after which this will reject... say the video is not playable
        // given that we'll load a data URI here from the caller, 3sec is a large enough time
        await withTimeout(waitForCanPlayThrough(videoElement), 3000);

        // obtain basic parameters
        const duration = videoElement.duration;
        const width = videoElement.videoWidth;
        const height = videoElement.videoHeight;
        let timeStep, frameTotal;

        // compute the time step based on extract by and extract count values
        if (by === 'rate') {
            timeStep = 1 / count;
            frameTotal = Infinity;
        } else if (by === 'count') {
            timeStep = duration / count;
            frameTotal = count;
        } else {
            throw new Error('Invalid extract by value: provide either "rate" or "count".');
        }

        // seek to beginning and wait for it to be ready in that state
        videoElement.currentTime = 0;
        await waitForSeeked(videoElement);

        // create an offscreen canvas to paint and extract frames from video timestamps
        const canvasElement = document.createElement('canvas');
        canvasElement.width = width;
        canvasElement.height = height;
        const context = canvasElement.getContext('2d');
        context.alpha = true; // Transparency support

        // metrics
        const frameExtractTimings = [];

        let frameCount = 0;
        for (let step = 0; step <= duration && frameCount < frameTotal; step += timeStep) {
            // progress video to desired timestamp
            videoElement.currentTime = step;

            // wait for successful seek
            await waitForSeeked(videoElement);

            // Clear the canvas before drawing the new frame!
            context.clearRect(0, 0, width, height);

            // paint and extract out a frame for the timestamp
            const extractTimeStart = performance.now();
            context.drawImage(videoElement, 0, 0, width, height);
            //const imageData = context.getImageData(0, 0, width, height);
            const imageDataBlob = await getCanvasPNGBlob(canvasElement);
            //const imageBitmap = await createImageBitmap(imageData);
            frameExtractTimings.push(performance.now() - extractTimeStart);

            // and collect it in the list of our frames
            frames.push(imageDataBlob);

            frameCount++;

            // update progress
            progressHook(Math.ceil((step / duration) * 100));
        }

        return {
            frames: frames,
            meta: {
                count: frames.length,
                avgTime: average(frameExtractTimings)
            }
        };
    };

    return {
        unpack: unpack
    };
})();

(async () => {
    const formElement = document.getElementById('video-form');
    const framesProgress = document.getElementById('frames-progress');
    // framesProgress.style.visibility = 'none';

    const disableInput = () => {
        formElement.style.pointerEvents = 'none';
        formElement.style.opacity = 0.5;
        // framesProgress.style.display = 'block';
    };

    const enableInput = () => {
        formElement.style.pointerEvents = '';
        formElement.style.opacity = 1;
        // framesProgress.style.display = 'none';
    };

    const updateProgress = (progressElement, value) => {
        progressElement.value = value;
    };

    const getValidatedFormData = () => {
        const fileElement = document.getElementById('video-file');
        const extractByElement = formElement.querySelector('#extract-by');
        const extractCountElement = formElement.querySelector('#extract-count');

        if (!fileElement || !extractByElement || !extractCountElement) {
            throw new Error('Required input elements missing!');
        }

        if (fileElement.files.length !== 1) {
            throw new Error('Video input missing!');
        }

        const extractBy = extractByElement.value;
        if (extractBy !== 'rate' && extractBy !== 'count') {
            throw new Error('Invalid extract by mode! Please choose "frame rate" or "frame count".');
        }

        const extractCount = Math.floor(parseInt(extractCountElement.value, 10));
        if (
            !(
                (extractBy === 'rate' && extractCount >= 1 && extractCount <= 60) ||
                (extractBy === 'count' && extractCount >= 1 && extractCount <= 3600)
            )
        ) {
            throw new Error('Invalid value in Step #3! Please provide correct value as instructed.');
        }

        return {
            videoFile: fileElement.files[0],
            extractBy: extractBy,
            extractCount: extractCount
        };
    };

    const loadVideoFile = async file => {
        return new Promise(resolve => {
            const fileReader = new FileReader();
            fileReader.onloadend = e => {
                resolve(e.target.result);
            };
            fileReader.readAsDataURL(file);
        });
    };

    const extractFrames = async () => {
        log(`\nValidating inputs...`);

        const formData = getValidatedFormData();

        log(`Loading video...`);

        const videoFile = formData.videoFile;
        const videoDataURI = await loadVideoFile(videoFile);

        log(`Extracting frames. This may take some time...`);

        const unpacked = await FrameUnpacker.unpack({
            url: videoDataURI,
            by: formData.extractBy,
            count: formData.extractCount,
            progress: value => {
                updateProgress(framesProgress, value);
            }
        });

        log(`Total frames extracted: ${unpacked.meta.count}`);
        log(`Average extraction time per frame: ${unpacked.meta.avgTime}ms`);

        return unpacked.frames;
    };

    const zipAndDownload = async (fileBlobs, fileNamePattern, zipFileName) => {
        log(`Creating a zip file with frames. This may take some time. PLEASE WAIT...`);

        const zip = new JSZip();

        const padCount = fileBlobs.length.toString().length;

        fileBlobs.forEach((fileBlob, index) => {
            zip.file(fileNamePattern.replace('{{id}}', (index + 1).toString().padStart(padCount, '0')), fileBlob);
        });

        zip.generateAsync({ type: 'blob' }).then(function (zipContent) {
            log(`Triggering zip file download...`);

            saveAs(zipContent, `${zipFileName}.zip`);

            log(`Done!`);
        });
    };

    formElement.addEventListener('submit', async e => {
        e.preventDefault();

        try {
            disableInput();
            updateProgress(framesProgress, 0);

            const frames = await extractFrames();

            await zipAndDownload(frames, 'frame-{{id}}.png', 'to-extracted-frames');
        } catch (err) {
            log(err);
        } finally {
            enableInput();
            updateProgress(framesProgress, 0);
        }
    });
})();