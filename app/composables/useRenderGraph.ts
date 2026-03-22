import type { Ref } from "vue";
import renderData from "~/assets/render/render_data.json";

interface RenderScene {
  name: string;
  width: string;
  height: string;
  copyright: string;
  images: Record<string, string>;
  pos: Record<string, [number, number]>;
  filter?: string;
}

export function useRenderGraph(
  canvasRef: Ref<HTMLCanvasElement | null>,
  skinUrl: Ref<string | undefined>,
) {
  const scenes = ref<RenderScene[]>(renderData as unknown as RenderScene[]);
  const currentIndex = ref(0);
  const isLoading = ref(false);

  // 缓存已加载的场景图片
  const imageCache: Record<string, Record<string, HTMLImageElement>> = {};

  // 辅助 canvas（延迟到客户端初始化，避免 SSR 报错）
  let resizeCanvas: HTMLCanvasElement;
  let remapCanvas: HTMLCanvasElement;
  let blurCanvas: HTMLCanvasElement;
  let blurCtx: CanvasRenderingContext2D;

  const canGoPrev = computed(() => currentIndex.value > 0);
  const canGoNext = computed(() => currentIndex.value < scenes.value.length - 1);

  /** 当前场景的宽高比，用于占位防止布局偏移 */
  const currentAspectRatio = computed(() => {
    const scene = scenes.value[currentIndex.value];
    if (!scene) return undefined;
    const w = Number(scene.width);
    const h = Number(scene.height);
    if (!w || !h) return undefined;
    return `${w} / ${h}`;
  });

  function goPrev() {
    if (canGoPrev.value) {
      currentIndex.value -= 1;
      renderCurrentScene();
    }
  }

  function goNext() {
    if (canGoNext.value) {
      currentIndex.value += 1;
      renderCurrentScene();
    }
  }

  function resizeSkin(image: HTMLImageElement, zoom: number) {
    const ctx = resizeCanvas.getContext("2d", { willReadFrequently: true })!;
    resizeCanvas.width = (image.width * zoom) | 0;
    resizeCanvas.height = resizeCanvas.width;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      image,
      0,
      0,
      image.width,
      image.height,
      0,
      0,
      (image.width * zoom) | 0,
      (image.height * zoom) | 0,
    );
  }

  function doBlurCanvas(canvas: HTMLCanvasElement) {
    blurCanvas.height = canvas.height;
    blurCanvas.width = canvas.width;
    blurCtx.clearRect(0, 0, blurCanvas.width, blurCanvas.height);
    blurCtx.filter = "blur(1px)";
    blurCtx.drawImage(canvas, 0, 0);
  }

  function remap(skin: HTMLImageElement, map: HTMLImageElement, illum: HTMLImageElement) {
    // 缩放皮肤至 256
    resizeSkin(skin, 256 / skin.width);
    const skinPixelData = resizeCanvas
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, resizeCanvas.width, resizeCanvas.height).data;

    // 将皮肤映射至图层
    const remapCtx = remapCanvas.getContext("2d", { willReadFrequently: true })!;
    remapCanvas.width = map.width;
    remapCanvas.height = map.height;
    remapCtx.drawImage(map, 0, 0);

    const mapImageData = remapCtx.getImageData(0, 0, remapCanvas.width, remapCanvas.height);
    const mapPixelData = mapImageData.data;

    for (let i = 0; i < mapPixelData.length; i += 4) {
      if (mapPixelData[i + 3] > 0) {
        const loc = (mapPixelData[i + 1] * resizeCanvas.width + mapPixelData[i]) * 4;
        mapPixelData[i] = (mapPixelData[i + 3] * skinPixelData[loc + 0]) / 255;
        mapPixelData[i + 1] = (mapPixelData[i + 3] * skinPixelData[loc + 1]) / 255;
        mapPixelData[i + 2] = (mapPixelData[i + 3] * skinPixelData[loc + 2]) / 255;
        mapPixelData[i + 3] = (mapPixelData[i + 3] * skinPixelData[loc + 3]) / 255;
      }
    }
    remapCtx.putImageData(mapImageData, 0, 0);

    // 绘制光影
    remapCtx.globalCompositeOperation = "multiply";
    remapCtx.drawImage(illum, 0, 0);
    remapCtx.globalCompositeOperation = "source-over";

    // 处理光影 Alpha 通道
    const finalImageData = remapCtx.getImageData(0, 0, remapCanvas.width, remapCanvas.height);
    const finalPixelData = finalImageData.data;

    for (let i = 3; i < finalPixelData.length; i += 4) {
      finalPixelData[i] = mapPixelData[i];
    }

    remapCtx.putImageData(finalImageData, 0, 0);
  }

  function compose(skinImage: HTMLImageElement) {
    const canvas = canvasRef.value;
    if (!canvas) return;

    const scene = scenes.value[currentIndex.value];
    if (!scene) return;

    const imgs = imageCache[scene.name];
    if (!imgs) return;

    const ctx = canvas.getContext("2d")!;
    canvas.width = Number(scene.width);
    canvas.height = Number(scene.height);

    // 使用滤镜
    ctx.filter = scene.filter || "";

    // 绘制背景1（定位用）
    ctx.drawImage(imgs.background0001, scene.pos.background0001[0], scene.pos.background0001[1]);

    // 模糊背景1
    doBlurCanvas(resizeCanvas);

    // 绘制模糊的背景1
    ctx.drawImage(blurCanvas, scene.pos.background0001[0], scene.pos.background0001[1]);

    // 绘制背景1（衔接玩家主体）
    ctx.drawImage(imgs.background0001, scene.pos.background0001[0], scene.pos.background0001[1]);

    // 玩家一层皮肤映射
    remap(skinImage, imgs.layer_matcolor0001, imgs.layer_illum0001);

    // 模糊第一层皮肤
    doBlurCanvas(remapCanvas);

    // 绘制模糊的第一层皮肤
    ctx.drawImage(blurCanvas, scene.pos.first[0], scene.pos.first[1]);

    // 绘制玩家一层皮肤（透明度 0.5）
    ctx.globalAlpha = 0.5;
    ctx.drawImage(remapCanvas, scene.pos.first[0], scene.pos.first[1]);
    ctx.globalAlpha = 1;

    // 绘制背景2（抗锯齿用，若提供则完整大小）
    if (imgs.background0000) {
      ctx.drawImage(imgs.background0000, 0, 0);
    }

    // 玩家二层皮肤映射
    remap(skinImage, imgs.layer_matcolor0002, imgs.layer_illum0002);

    // 模糊第二层皮肤
    doBlurCanvas(remapCanvas);

    // 绘制模糊的第二层皮肤
    ctx.drawImage(blurCanvas, scene.pos.second[0], scene.pos.second[1]);

    // 绘制玩家二层皮肤（透明度 0.5）
    ctx.globalAlpha = 0.5;
    ctx.drawImage(remapCanvas, scene.pos.second[0], scene.pos.second[1]);
    ctx.globalAlpha = 1;

    isLoading.value = false;
  }

  function loadSceneImages(scene: RenderScene): Promise<Record<string, HTMLImageElement>> {
    if (imageCache[scene.name]) {
      return Promise.resolve(imageCache[scene.name]);
    }

    const entries = Object.entries(scene.images);
    const loaded: Record<string, HTMLImageElement> = {};
    let count = 0;

    return new Promise((resolve, reject) => {
      for (const [key, filename] of entries) {
        const img = new Image();
        img.onload = () => {
          loaded[key] = img;
          count += 1;
          if (count === entries.length) {
            imageCache[scene.name] = loaded;
            resolve(loaded);
          }
        };
        img.onerror = () => reject(new Error(`Failed to load ${filename}`));
        img.src = `/images/render/${scene.name}/${filename}`;
      }
    });
  }

  function renderCurrentScene() {
    const url = skinUrl.value;
    if (!url || scenes.value.length === 0) return;

    const scene = scenes.value[currentIndex.value];
    if (!scene) return;

    isLoading.value = true;

    const skinImage = new Image();
    skinImage.crossOrigin = "anonymous";

    skinImage.onload = async () => {
      try {
        await loadSceneImages(scene);
        compose(skinImage);
      } catch {
        isLoading.value = false;
      }
    };

    skinImage.onerror = () => {
      isLoading.value = false;
    };

    skinImage.src = url;
  }

  watch(skinUrl, () => {
    renderCurrentScene();
  });

  onMounted(() => {
    resizeCanvas = document.createElement("canvas");
    remapCanvas = document.createElement("canvas");
    blurCanvas = document.createElement("canvas");
    blurCtx = blurCanvas.getContext("2d")!;

    if (skinUrl.value) {
      renderCurrentScene();
    }
  });

  onUnmounted(() => {
    // 清理缓存的 Image 对象
    for (const key of Object.keys(imageCache)) {
      delete imageCache[key];
    }
  });

  return {
    scenes,
    currentIndex,
    isLoading,
    canGoPrev,
    canGoNext,
    currentAspectRatio,
    goPrev,
    goNext,
    render: renderCurrentScene,
  };
}
