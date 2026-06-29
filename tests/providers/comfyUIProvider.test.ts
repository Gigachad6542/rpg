import { describe, expect, it, vi } from "vitest";

import { ComfyUIImageProvider } from "../../src/providers/comfyUIProvider";

describe("ComfyUI image provider", () => {
  it("queues a hydrated workflow and returns a local view URL", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: "prompt-1" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            "prompt-1": {
              outputs: {
                "9": {
                  images: [{ filename: "map.png", subfolder: "local-cards", type: "output" }],
                },
              },
            },
          }),
          { status: 200 },
        ),
      );
    const provider = new ComfyUIImageProvider({
      endpoint: "http://127.0.0.1:8188",
      model: "FLUX.1-schnell",
      workflowJson: JSON.stringify({
        "1": {
          class_type: "CLIPTextEncode",
          inputs: {
            text: "{{prompt}}",
          },
        },
        "2": {
          class_type: "EmptyLatentImage",
          inputs: {
            width: "{{width}}",
            height: "{{height}}",
          },
        },
        "3": {
          class_type: "KSampler",
          inputs: {
            seed: "{{seed}}",
            steps: "{{steps}}",
            cfg: "{{cfg}}",
            sampler_name: "{{sampler}}",
            scheduler: "{{scheduler}}",
          },
        },
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1,
    });

    const result = await provider.generateImage({
      model: "FLUX.1-schnell",
      prompt: "birdseye map of the cellar",
      negativePrompt: "first person",
      width: 768,
      height: 640,
      seed: 123,
      steps: 18,
      cfg: 6.5,
      samplerName: "dpmpp_2m",
      scheduler: "karras",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8188/prompt",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const queueBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(queueBody.prompt["1"].inputs.text).toBe("birdseye map of the cellar");
    expect(queueBody.prompt["2"].inputs.width).toBe(768);
    expect(queueBody.prompt["3"].inputs.seed).toBe(123);
    expect(queueBody.prompt["3"].inputs.steps).toBe(18);
    expect(queueBody.prompt["3"].inputs.cfg).toBe(6.5);
    expect(queueBody.prompt["3"].inputs.sampler_name).toBe("dpmpp_2m");
    expect(queueBody.prompt["3"].inputs.scheduler).toBe("karras");
    expect(result.images[0]?.url).toBe(
      "http://127.0.0.1:8188/view?filename=map.png&subfolder=local-cards&type=output",
    );
  });

  it("rejects non-loopback endpoints", () => {
    expect(
      () =>
        new ComfyUIImageProvider({
          endpoint: "https://example.test",
          workflowJson: "{}",
        }),
    ).toThrow(/loopback/i);
  });
});
