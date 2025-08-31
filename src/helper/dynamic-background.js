import paper from '@scratch/paper';
import { isInfiniteCanvasEnabled, BASE } from './view';
import { getBackgroundGuideLayer, rebuildBackgroundGuideLayer } from './layer';

const CHECKERBOARD_SIZE = 8;
let lastViewCenter = null;
let lastViewZoom = null;
let updateBackgroundTimeout = null;
// 新增：节流状态标记
let throttleCooling = false;
let throttlePending = false;

// Track mode changes
let lastInfiniteMode = null;
let modeWatchInterval = null;
let _getCurrentFormat = null;
// Keep original onFrame so we can restore it when leaving infinite mode
let originalOnFrameHandler = null;
let onFrameWrapped = false;

/**
 * Update the infinite canvas background to cover the current view
 */
const updateInfiniteBackground = () => {
    if (!isInfiniteCanvasEnabled() || !paper.view) return;
    const backgroundGuideLayer = getBackgroundGuideLayer();
    if (!backgroundGuideLayer || !backgroundGuideLayer.vectorBackground) return;

    const vectorBackground = backgroundGuideLayer.vectorBackground;

    // Find the background group (should be the last child in infinite canvas mode)
    let backgroundGroup = null;
    for (let i = vectorBackground.children.length - 1; i >= 0; i--) {
        const child = vectorBackground.children[i];
        if (child.children && child.children.length >= 2) {
            backgroundGroup = child;
            break;
        }
    }

    if (!backgroundGroup) return;

    // Calculate new background size based on current view
    const viewBounds = paper.view.bounds;
    const scale = Math.max(3, Math.ceil(Math.max(viewBounds.width, viewBounds.height) / BASE.ART_BOARD_WIDTH));
    const newSize = {
        width: BASE.ART_BOARD_WIDTH * scale,
        height: BASE.ART_BOARD_HEIGHT * scale
    };

    // Update background position aligned to grid based on current view
    const c = paper.view.center;
    const tileSize = ((backgroundGroup.scaling && backgroundGroup.scaling.x) ? backgroundGroup.scaling.x : CHECKERBOARD_SIZE) * 16; // for a tile size, 8px
    const mod = (a, b) => ((a % b) + b) % b; // floor-style positive modulo
    const alignedX = c.x - mod(c.x, tileSize);
    const alignedY = c.y - mod(c.y, tileSize);
    backgroundGroup.position = new paper.Point(alignedX, alignedY);

    // Update background size by scaling
    const currentSize = backgroundGroup.bounds;
    if (currentSize.width > 0 && currentSize.height > 0) {
        const scaleX = newSize.width / currentSize.width;
        const scaleY = newSize.height / currentSize.height;
        const uniformScale = Math.max(scaleX, scaleY);

        // Only scale if the change is significant (avoid unnecessary updates)
        if (uniformScale < 0.7 || uniformScale > 1.5) {
            backgroundGroup.scale(uniformScale, backgroundGroup.position);
        }
    }
};

/**
 * Throttled version of updateInfiniteBackground to avoid excessive updates
 */
const updateInfiniteBackgroundThrottled = () => {
    if (!throttleCooling) {
        throttleCooling = true;
        updateInfiniteBackground();
        if (updateBackgroundTimeout) clearTimeout(updateBackgroundTimeout);
        updateBackgroundTimeout = setTimeout(() => {
            throttleCooling = false;
            if (throttlePending) {
                throttlePending = false;
                updateInfiniteBackgroundThrottled();
            }
        }, 100); // Max 10 updates per second
    } else {
        throttlePending = true;
    }
};

/**
 * Apply/Remove workspace clipping mask based on current mode.
 * This affects already imported SVG/Bitmap content when toggling modes.
 */
const adjustWorkspaceMaskForMode = () => {
    if (!paper.project || !paper.project.activeLayer) return;
    const layer = paper.project.activeLayer;

    // Find existing clip mask (if any)
    let mask = null;
    if (layer.children) {
        for (const child of layer.children) {
            if (typeof child.isClipMask === 'function' && child.isClipMask()) {
                mask = child;
                break;
            }
        }
    }

    if (isInfiniteCanvasEnabled()) {
        // Remove clipping in infinite mode
        if (mask) {
            layer.clipped = false;
            mask.remove();
        }
    } else {
        // Ensure clipping exists and matches workspace bounds in bounded mode
        if (!mask) {
            mask = new paper.Shape.Rectangle(BASE.MAX_WORKSPACE_BOUNDS);
            mask.guide = true;
            mask.locked = true;
            mask.position = BASE.CENTER;
            layer.addChild(mask);
            mask.clipMask = true;
        } else {
            mask.size.height = BASE.MAX_WORKSPACE_BOUNDS.height;
            mask.size.width = BASE.MAX_WORKSPACE_BOUNDS.width;
            mask.setPosition(BASE.CENTER);
            mask.clipMask = true;
        }
    }
};

/**
 * Set up event listeners for view changes in infinite canvas mode
 */
const setupInfiniteBackgroundUpdates = () => {
    if (!isInfiniteCanvasEnabled()) return;

    // Ensure paper.view is available with retry mechanism
    const setupWithRetry = (retryCount = 0) => {
        if (paper.view) {
            // // Avoid wrapping multiple times
            // if (!onFrameWrapped) {
            //     originalOnFrameHandler = paper.view.onFrame;
            //     const wrappedOnFrame = (event) => {
            //         if (originalOnFrameHandler) originalOnFrameHandler.call(paper.view, event);
            //         updateInfiniteBackgroundThrottled();
            //     };
            //     paper.view.onFrame = wrappedOnFrame;
            //     onFrameWrapped = true;
            // }

            // Force initial background update after setup
            setTimeout(() => {
                forceUpdateInfiniteBackground();
            }, 50);
        } else if (retryCount < 10) {
            // Retry up to 10 times with exponential backoff
            setTimeout(() => {
                setupWithRetry(retryCount + 1);
            }, Math.min(100 * Math.pow(2, retryCount), 1000));
        }
    };

    setupWithRetry();
};

// Tear down listeners and timers when leaving infinite mode
const teardownInfiniteBackgroundUpdates = () => {
    if (updateBackgroundTimeout) {
        clearTimeout(updateBackgroundTimeout);
        updateBackgroundTimeout = null;
    }
    if (paper.view && onFrameWrapped) {
        paper.view.onFrame = originalOnFrameHandler;
        originalOnFrameHandler = null;
        onFrameWrapped = false;
    }
    lastViewCenter = null;
    lastViewZoom = null;
    throttleCooling = false;
    throttlePending = false;
};

/**
 * Watch for changes in infinite canvas mode and rebuild background accordingly
 * @param {Function} getCurrentFormat - A function returning current image format string
 */
const watchInfiniteCanvasModeToggle = (getCurrentFormat) => {
    _getCurrentFormat = getCurrentFormat;
    lastInfiniteMode = isInfiniteCanvasEnabled();

    if (modeWatchInterval) {
        clearInterval(modeWatchInterval);
    }

    modeWatchInterval = setInterval(() => {
        const currentMode = isInfiniteCanvasEnabled();
        if (currentMode !== lastInfiniteMode) {
            lastInfiniteMode = currentMode;
            const format = typeof _getCurrentFormat === 'function' ? _getCurrentFormat() : undefined;
            // Rebuild background to reflect new mode
            rebuildBackgroundGuideLayer(format);
            // Sync clipping with new mode for already imported content
            adjustWorkspaceMaskForMode();

            if (currentMode) {
                // When switching to infinite mode, set up updates and force refresh
                setupInfiniteBackgroundUpdates();
                forceUpdateInfiniteBackground();
            } else {
                // When switching back, restore original onFrame and clear timers
                teardownInfiniteBackgroundUpdates();
            }
        }
    }, 250);
};

/**
 * Stop watching for infinite canvas mode changes
 */
const stopWatchingInfiniteCanvasModeToggle = () => {
    if (modeWatchInterval) {
        clearInterval(modeWatchInterval);
        modeWatchInterval = null;
    }
    _getCurrentFormat = null;
    // Also tear down in case we're leaving while wrapped
    teardownInfiniteBackgroundUpdates();
};

/**
 * Force an immediate background update
 */
const forceUpdateInfiniteBackground = () => {
    if (updateBackgroundTimeout) {
        clearTimeout(updateBackgroundTimeout);
        updateBackgroundTimeout = null;
    }
    // if we're not ready yet, try again later
    const tryUpdate = (retryCount = 0) => {
        if (paper.view) {
            lastViewCenter = null; // Force update on next check
            lastViewZoom = null;
            updateInfiniteBackground();
        } else if (retryCount < 10) {
            setTimeout(() => tryUpdate(retryCount + 1), Math.min(100 * Math.pow(2, retryCount), 1000));
        }
    };

    tryUpdate();
};

export {
    updateInfiniteBackground,
    updateInfiniteBackgroundThrottled,
    setupInfiniteBackgroundUpdates,
    // expose teardown for completeness (optional external use)
    teardownInfiniteBackgroundUpdates,
    forceUpdateInfiniteBackground,
    watchInfiniteCanvasModeToggle,
    stopWatchingInfiniteCanvasModeToggle
};