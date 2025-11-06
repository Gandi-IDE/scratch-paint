import paper from '@scratch/paper';
import { isBitmap, isVector } from '../lib/format';
import log from '../log/log';
import { isGroupItem } from './item';
import { BASE, isInfiniteCanvasEnabled } from './view';

const CHECKERBOARD_SIZE = 8;
const CROSSHAIR_SIZE = 16;
const CROSSHAIR_FULL_OPACITY = 0.75;

const _getLayer = function (layerString) {
    for (const layer of paper.project.layers) {
        if (layer.data && layer.data[layerString]) {
            return layer;
        }
    }
};

const _getPaintingLayer = function () {
    return _getLayer('isPaintingLayer');
};

/**
 * Creates a canvas with width and height matching the art board size.
 * @param {?number} width Width of the canvas. Defaults to BASE.ART_BOARD_WIDTH.
 * @param {?number} height Height of the canvas. Defaults to BASE.ART_BOARD_HEIGHT.
 * @return {HTMLCanvasElement} the canvas
 */
const createCanvas = function (width, height) {
    const canvas = document.createElement('canvas');
    if (width && height) {
        canvas.width = width;
        canvas.height = height;
    } else if (isInfiniteCanvasEnabled()) {
        // In infinite canvas mode, create a larger default canvas
        const viewBounds = paper.view ? paper.view.bounds : null;
        if (viewBounds) {
            // Create canvas based on current view bounds with some padding
            const padding = Math.max(BASE.ART_BOARD_WIDTH, BASE.ART_BOARD_HEIGHT);
            canvas.width = Math.max(BASE.ART_BOARD_WIDTH, viewBounds.width + padding * 2);
            canvas.height = Math.max(BASE.ART_BOARD_HEIGHT, viewBounds.height + padding * 2);
        } else {
            // Fallback to larger default size
            canvas.width = BASE.ART_BOARD_WIDTH * 4;
            canvas.height = BASE.ART_BOARD_HEIGHT * 4;
        }
    } else {
        canvas.width = BASE.ART_BOARD_WIDTH;
        canvas.height = BASE.ART_BOARD_HEIGHT;
    }
    canvas.getContext('2d').imageSmoothingEnabled = false;
    return canvas;
};

const clearRaster = function () {
    const layer = _getLayer('isRasterLayer');
    layer.removeChildren();

    // Generate blank raster
    const raster = new paper.Raster(createCanvas());
    raster.canvas.getContext('2d').imageSmoothingEnabled = false;
    raster.parent = layer;
    raster.guide = true;
    raster.locked = true;
    raster.position = BASE.CENTER;
};

const getRaster = function () {
    const layer = _getLayer('isRasterLayer');
    // Generate blank raster
    if (layer.children.length === 0) {
        clearRaster();
    }
    return _getLayer('isRasterLayer').children[0];
};

const getDragCrosshairLayer = function () {
    return _getLayer('isDragCrosshairLayer');
};

const getBackgroundGuideLayer = function () {
    return _getLayer('isBackgroundGuideLayer');
};

const getOutlineLayer = function () {
    return _getLayer('isOutlineLayer');
};

const _convertLayer = function (layer, format) {
    layer.bitmapBackground.visible = isBitmap(format);
    layer.vectorBackground.visible = isVector(format);
};

const convertBackgroundGuideLayer = function (format) {
    _convertLayer(getBackgroundGuideLayer(), format);
};

const _makeGuideLayer = function () {
    const guideLayer = new paper.Layer();
    guideLayer.data.isGuideLayer = true;
    return guideLayer;
};

const getGuideLayer = function () {
    let layer = _getLayer('isGuideLayer');
    if (!layer) {
        layer = _makeGuideLayer();
        _getPaintingLayer().activate();
    }
    return layer;
};

const setGuideItem = function (item) {
    item.locked = true;
    item.guide = true;
    if (isGroupItem(item)) {
        for (let i = 0; i < item.children.length; i++) {
            setGuideItem(item.children[i]);
        }
    }
};

/**
 * Removes the guide layers, e.g. for purposes of exporting the image. Must call showGuideLayers to re-add them.
 * @param {boolean} includeRaster true if the raster layer should also be hidden
 * @return {object} an object of the removed layers, which should be passed to showGuideLayers to re-add them.
 */
const hideGuideLayers = function (includeRaster) {
    const backgroundGuideLayer = getBackgroundGuideLayer();
    const dragCrosshairLayer = getDragCrosshairLayer();
    const outlineLayer = _getLayer('isOutlineLayer');
    const guideLayer = getGuideLayer();
    dragCrosshairLayer.remove();
    outlineLayer.remove();
    guideLayer.remove();
    backgroundGuideLayer.remove();
    let rasterLayer;
    if (includeRaster) {
        rasterLayer = _getLayer('isRasterLayer');
        rasterLayer.remove();
    }
    return {
        dragCrosshairLayer: dragCrosshairLayer,
        outlineLayer: outlineLayer,
        guideLayer: guideLayer,
        backgroundGuideLayer: backgroundGuideLayer,
        rasterLayer: rasterLayer
    };
};

/**
 * Add back the guide layers removed by calling hideGuideLayers. This must be done before any editing operations are
 * taken in the paint editor.
 * @param {!object} guideLayers object of the removed layers, which was returned by hideGuideLayers
 */
const showGuideLayers = function (guideLayers) {
    const backgroundGuideLayer = guideLayers.backgroundGuideLayer;
    const dragCrosshairLayer = guideLayers.dragCrosshairLayer;
    const outlineLayer = guideLayers.outlineLayer;
    const guideLayer = guideLayers.guideLayer;
    const rasterLayer = guideLayers.rasterLayer;
    if (rasterLayer && !rasterLayer.index) {
        paper.project.addLayer(rasterLayer);
        rasterLayer.sendToBack();
    }
    if (!backgroundGuideLayer.index) {
        paper.project.addLayer(backgroundGuideLayer);
        backgroundGuideLayer.sendToBack();
    }
    if (!dragCrosshairLayer.index) {
        paper.project.addLayer(dragCrosshairLayer);
        dragCrosshairLayer.bringToFront();
    }
    if (!outlineLayer.index) {
        paper.project.addLayer(outlineLayer);
        outlineLayer.bringToFront();
    }
    if (!guideLayer.index) {
        paper.project.addLayer(guideLayer);
        guideLayer.bringToFront();
    }
    if (paper.project.activeLayer !== _getPaintingLayer()) {
        log.error(`Wrong active layer`);
        log.error(paper.project.activeLayer.data);
    }
};

const _makePaintingLayer = function () {
    const paintingLayer = new paper.Layer();
    paintingLayer.data.isPaintingLayer = true;
    return paintingLayer;
};

const _makeRasterLayer = function () {
    const rasterLayer = new paper.Layer();
    rasterLayer.data.isRasterLayer = true;
    clearRaster();
    return rasterLayer;
};

const BACKGROUND_LIGHT = '#FFFFFF';
const BACKGROUND_TILE_LIGHT = '#D9E3F2';
const BACKGROUND_DARK = '#111';
const BACKGROUND_TILE_DARK = '#222';

const _makeBackgroundPaper = function (width, height, opacity) {
    // creates a checkerboard path of width * height squares in color on white
    let x = 0;
    let y = 0;
    const pathPoints = [];
    while (x < width) {
        pathPoints.push(new paper.Point(x, y));
        x++;
        pathPoints.push(new paper.Point(x, y));
        y = y === 0 ? height : 0;
    }
    y = height - 1;
    x = width;
    while (y > 0) {
        pathPoints.push(new paper.Point(x, y));
        x = (x === 0 ? width : 0);
        pathPoints.push(new paper.Point(x, y));
        y--;
    }

    const vRect = isInfiniteCanvasEnabled() ?
        new paper.Shape.Rectangle(
            new paper.Point(0, 0),
            new paper.Point(width, height)) :
        new paper.Shape.Rectangle(
            new paper.Point(0, 0),
            new paper.Point(BASE.ART_BOARD_WIDTH / CHECKERBOARD_SIZE, BASE.ART_BOARD_HEIGHT / CHECKERBOARD_SIZE));
    vRect.fillColor = BACKGROUND_LIGHT;
    vRect.guide = true;
    vRect.locked = true;
    const vPath = new paper.Path(pathPoints);
    vPath.fillRule = 'evenodd';
    vPath.fillColor = BACKGROUND_TILE_LIGHT;
    vPath.opacity = opacity;
    vPath.guide = true;
    vPath.locked = true;
    let mask = new paper.Shape.Rectangle(new paper.Point(0, 0), new paper.Point(width, height));
    if (!isInfiniteCanvasEnabled()) {
        vRect.position = BASE.CENTER;
        vPath.position = BASE.CENTER;
        mask = new paper.Shape.Rectangle(BASE.MAX_WORKSPACE_BOUNDS);
        mask.position = BASE.CENTER;
        mask.scale(1 / CHECKERBOARD_SIZE);
    }
    mask.guide = true;
    mask.locked = true;
    const vGroup = new paper.Group([vRect, vPath, mask]);
    mask.clipMask = true;
    return vGroup;
};

const CROSSHAIR_INNER_LIGHT = '#000000';
const CROSSHAIR_OUTER_LIGHT = '#FFFFFF';

// Helper function for drawing a crosshair
const _makeCrosshair = function (opacity, parent) {
    const crosshair = new paper.Group();

    const vLine2 = new paper.Path.Line(new paper.Point(0, -7), new paper.Point(0, 7));
    vLine2.strokeWidth = 6;
    vLine2.strokeColor = CROSSHAIR_OUTER_LIGHT;
    vLine2.strokeCap = 'round';
    crosshair.addChild(vLine2);
    const hLine2 = new paper.Path.Line(new paper.Point(-7, 0), new paper.Point(7, 0));
    hLine2.strokeWidth = 6;
    hLine2.strokeColor = CROSSHAIR_OUTER_LIGHT;
    hLine2.strokeCap = 'round';
    crosshair.addChild(hLine2);
    const circle2 = new paper.Shape.Circle(new paper.Point(0, 0), 5.5);
    circle2.strokeWidth = 6;
    circle2.strokeColor = CROSSHAIR_OUTER_LIGHT;
    crosshair.addChild(circle2);

    const vLine = new paper.Path.Line(new paper.Point(0, -7), new paper.Point(0, 7));
    vLine.strokeWidth = 2;
    vLine.strokeColor = CROSSHAIR_INNER_LIGHT;
    vLine.strokeCap = 'round';
    crosshair.addChild(vLine);
    const hLine = new paper.Path.Line(new paper.Point(-7, 0), new paper.Point(7, 0));
    hLine.strokeWidth = 2;
    hLine.strokeColor = CROSSHAIR_INNER_LIGHT;
    hLine.strokeCap = 'round';
    crosshair.addChild(hLine);
    const circle = new paper.Shape.Circle(new paper.Point(0, 0), 5.5);
    circle.strokeWidth = 2;
    circle.strokeColor = CROSSHAIR_INNER_LIGHT;
    crosshair.addChild(circle);

    setGuideItem(crosshair);
    crosshair.position = BASE.CENTER;
    crosshair.opacity = opacity;
    crosshair.parent = parent;
    crosshair.applyMatrix = false;
    parent.dragCrosshair = crosshair;
    crosshair.scale(CROSSHAIR_SIZE / crosshair.bounds.width / paper.view.zoom);
};

const _makeDragCrosshairLayer = function () {
    const dragCrosshairLayer = new paper.Layer();
    _makeCrosshair(CROSSHAIR_FULL_OPACITY, dragCrosshairLayer);
    dragCrosshairLayer.data.isDragCrosshairLayer = true;
    dragCrosshairLayer.visible = false;
    return dragCrosshairLayer;
};

const OUTLINE_INNER_LIGHT = '#FFFFFF';
const OUTLINE_OUTER_LIGHT = '#4280D7';
const OUTLINE_INNER_DARK = '#555555';

const _makeOutlineLayer = function () {
    const outlineLayer = new paper.Layer();
    const whiteRect = new paper.Shape.Rectangle(BASE.ART_BOARD_BOUNDS.expand(1));
    whiteRect.strokeWidth = 2;
    whiteRect.strokeColor = OUTLINE_INNER_LIGHT;
    setGuideItem(whiteRect);
    const blueRect = new paper.Shape.Rectangle(BASE.ART_BOARD_BOUNDS.expand(5));
    blueRect.strokeWidth = 2;
    blueRect.strokeColor = OUTLINE_OUTER_LIGHT;
    blueRect.opacity = 0.25;
    setGuideItem(blueRect);
    outlineLayer.data.isOutlineLayer = true;
    return outlineLayer;
};

const WORKSPACE_BOUNDS_LIGHT = '#ECF1F9';
const WORKSPACE_BOUNDS_DARK = '#333';

const _makeBackgroundGuideLayer = function (format) {
    const guideLayer = new paper.Layer();
    guideLayer.locked = true;

    const vectorBackground = new paper.Group();

    // Only create workspace bounds in non-infinite canvas mode
    if (!isInfiniteCanvasEnabled()) {
        const vWorkspaceBounds = new paper.Shape.Rectangle(BASE.MAX_WORKSPACE_BOUNDS);
        vWorkspaceBounds.fillColor = WORKSPACE_BOUNDS_LIGHT;
        vWorkspaceBounds.position = BASE.CENTER;
        vectorBackground.addChild(vWorkspaceBounds);
    }

    // Create dynamic background based on infinite canvas mode
    let backgroundSize;
    if (isInfiniteCanvasEnabled()) {
        // For infinite canvas, create a much larger background that adapts to view
        const viewBounds = paper.view ? paper.view.bounds : null;
        if (viewBounds) {
            const scale = Math.max(4, Math.ceil(Math.max(viewBounds.width, viewBounds.height) / BASE.ART_BOARD_WIDTH));
            backgroundSize = {
                width: BASE.ART_BOARD_WIDTH * scale / CHECKERBOARD_SIZE,
                height: BASE.ART_BOARD_HEIGHT * scale / CHECKERBOARD_SIZE
            };
        } else {
            console.log("No view bounds found");
            backgroundSize = {
                width: BASE.ART_BOARD_WIDTH * 8 / CHECKERBOARD_SIZE,
                height: BASE.ART_BOARD_HEIGHT * 8 / CHECKERBOARD_SIZE
            };
        }
    } else {
        console.log("No workspace bounds found");
        // Add 1 to the height because it's an odd number otherwise, and we want it to be even
        // so the corner of the checkerboard to line up with the center crosshair
        backgroundSize = {
            width: BASE.MAX_WORKSPACE_BOUNDS.width / CHECKERBOARD_SIZE,
            height: (BASE.MAX_WORKSPACE_BOUNDS.height / CHECKERBOARD_SIZE) + 1
        };
    }

    const vBackground = _makeBackgroundPaper(
        backgroundSize.width,
        backgroundSize.height,
        0.55);

    if (isInfiniteCanvasEnabled()) {
        const viewCenter = paper.view ? paper.view.center : BASE.CENTER;
        vBackground.position = viewCenter;
    } else {
        vBackground.position = BASE.CENTER;
    }

    vBackground.scaling = new paper.Point(CHECKERBOARD_SIZE, CHECKERBOARD_SIZE);

    vectorBackground.addChild(vBackground);
    setGuideItem(vectorBackground);
    guideLayer.vectorBackground = vectorBackground;

    const bitmapBackground = _makeBackgroundPaper(
        BASE.ART_BOARD_WIDTH / CHECKERBOARD_SIZE,
        BASE.ART_BOARD_HEIGHT / CHECKERBOARD_SIZE,
        0.55);
    bitmapBackground.position = BASE.CENTER;
    bitmapBackground.scaling = new paper.Point(CHECKERBOARD_SIZE, CHECKERBOARD_SIZE);
    bitmapBackground.guide = true;
    bitmapBackground.locked = true;
    guideLayer.bitmapBackground = bitmapBackground;

    _convertLayer(guideLayer, format);

    _makeCrosshair(0.16, guideLayer);

    guideLayer.data.isBackgroundGuideLayer = true;
    return guideLayer;
};

const updateTheme = function (theme) {
    const isDark = theme === 'dark';

    const backgroundGuideLayer = getBackgroundGuideLayer();
    const bitmapChildren = backgroundGuideLayer.bitmapBackground.children;
    bitmapChildren[0].fillColor = isDark ? BACKGROUND_DARK : BACKGROUND_LIGHT;
    bitmapChildren[1].fillColor = isDark ? BACKGROUND_TILE_DARK : BACKGROUND_TILE_LIGHT;

    const vectorChildren = backgroundGuideLayer.vectorBackground.children;
    // In infinite canvas mode, workspace bounds might not exist
    if (!isInfiniteCanvasEnabled() && vectorChildren.length > 1) {
        vectorChildren[0].fillColor = isDark ? WORKSPACE_BOUNDS_DARK : WORKSPACE_BOUNDS_LIGHT;
        vectorChildren[1].children[0].fillColor = isDark ? BACKGROUND_DARK : BACKGROUND_LIGHT;
        vectorChildren[1].children[1].fillColor = isDark ? BACKGROUND_TILE_DARK : BACKGROUND_TILE_LIGHT;
    } else if (isInfiniteCanvasEnabled() && vectorChildren.length > 0) {
        // In infinite canvas mode, the background is the first (and possibly only) child
        vectorChildren[0].children[0].fillColor = isDark ? BACKGROUND_DARK : BACKGROUND_LIGHT;
        vectorChildren[0].children[1].fillColor = isDark ? BACKGROUND_TILE_DARK : BACKGROUND_TILE_LIGHT;
    }

    const outlineLayer = getOutlineLayer();
    outlineLayer.children[0].strokeColor = isDark ? OUTLINE_INNER_DARK : OUTLINE_INNER_LIGHT;
};

const setupLayers = function (format) {
    const backgroundGuideLayer = _makeBackgroundGuideLayer(format);
    _makeRasterLayer();
    const paintLayer = _makePaintingLayer();
    const dragCrosshairLayer = _makeDragCrosshairLayer();
    const outlineLayer = _makeOutlineLayer();
    const guideLayer = _makeGuideLayer();
    backgroundGuideLayer.sendToBack();
    dragCrosshairLayer.bringToFront();
    outlineLayer.bringToFront();
    guideLayer.bringToFront();
    paintLayer.activate();
};

/**
 * Rebuild the background guide layer with correct sizing for current canvas mode
 * @param {string} format - The current image format
 * @return {object} The new background guide layer
 */
const rebuildBackgroundGuideLayer = function (format) {
    const oldLayer = getBackgroundGuideLayer();
    const layerIndex = oldLayer ? paper.project.layers.indexOf(oldLayer) : 0;
    
    // Remove old background layer
    if (oldLayer) {
        oldLayer.remove();
    }
    
    // Create new background layer with current mode settings
    const newLayer = _makeBackgroundGuideLayer(format);
    
    // Insert at the same position (should be at the back)
    if (layerIndex >= 0) {
        paper.project.insertLayer(layerIndex, newLayer);
    }
    newLayer.sendToBack();
    
    // Ensure painting layer is active
    const paintingLayer = _getPaintingLayer();
    if (paintingLayer) {
        paintingLayer.activate();
    }
    
    return newLayer;
};

export {
    CROSSHAIR_SIZE,
    CROSSHAIR_FULL_OPACITY,
    createCanvas,
    hideGuideLayers,
    showGuideLayers,
    getDragCrosshairLayer,
    getGuideLayer,
    getBackgroundGuideLayer,
    convertBackgroundGuideLayer,
    clearRaster,
    getRaster,
    setGuideItem,
    updateTheme,
    setupLayers,
    rebuildBackgroundGuideLayer
};
