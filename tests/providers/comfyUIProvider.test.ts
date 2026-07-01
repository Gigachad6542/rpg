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
      apiKey: "comfy-session-key",
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
        headers: expect.objectContaining({
          authorization: "Bearer comfy-session-key",
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8188/history/prompt-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer comfy-session-key",
        }),
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

  it("overrides hard-coded low quality sampler and latent settings with the app request", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: "prompt-quality" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            "prompt-quality": {
              outputs: {
                "9": {
                  images: [{ filename: "quality.png", subfolder: "", type: "output" }],
                },
              },
            },
          }),
          { status: 200 },
        ),
      );
    const provider = new ComfyUIImageProvider({
      endpoint: "http://127.0.0.1:8188",
      workflowJson: JSON.stringify({
        "3": {
          class_type: "KSampler",
          inputs: {
            seed: 1,
            steps: 4,
            cfg: 1,
            sampler_name: "euler",
            scheduler: "normal",
          },
        },
        "5": {
          class_type: "EmptyLatentImage",
          inputs: {
            width: 256,
            height: 256,
            batch_size: 1,
          },
        },
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1,
    });

    await provider.generateImage({
      model: "local-image",
      prompt: "sharp map",
      negativePrompt: "blurry",
      width: 1024,
      height: 1024,
      seed: 12345,
      steps: 28,
      cfg: 6.5,
      samplerName: "dpmpp_2m",
      scheduler: "karras",
    });

    const queueBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(queueBody.prompt["5"].inputs.width).toBe(1024);
    expect(queueBody.prompt["5"].inputs.height).toBe(1024);
    expect(queueBody.prompt["3"].inputs.seed).toBe(12345);
    expect(queueBody.prompt["3"].inputs.steps).toBe(28);
    expect(queueBody.prompt["3"].inputs.cfg).toBe(6.5);
    expect(queueBody.prompt["3"].inputs.sampler_name).toBe("dpmpp_2m");
    expect(queueBody.prompt["3"].inputs.scheduler).toBe("karras");
  });

  it("raises one-step image requests to local-image-safe generation settings", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: "prompt-one-step" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            "prompt-one-step": {
              outputs: {
                "9": {
                  images: [{ filename: "rescued.png", subfolder: "", type: "output" }],
                },
              },
            },
          }),
          { status: 200 },
        ),
      );
    const provider = new ComfyUIImageProvider({
      endpoint: "http://127.0.0.1:8188",
      workflowJson: JSON.stringify({
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
        "5": {
          class_type: "EmptyLatentImage",
          inputs: {
            width: "{{width}}",
            height: "{{height}}",
            batch_size: 1,
          },
        },
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1,
    });

    await provider.generateImage({
      model: "local-image",
      prompt: "map",
      width: 1024,
      height: 1024,
      seed: 123,
      steps: 1,
      cfg: 1,
      samplerName: "euler",
      scheduler: "normal",
    });

    const queueBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(queueBody.prompt["5"].inputs.width).toBe(1024);
    expect(queueBody.prompt["5"].inputs.height).toBe(1024);
    expect(queueBody.prompt["3"].inputs.steps).toBe(28);
    expect(queueBody.prompt["3"].inputs.cfg).toBe(3.5);
    expect(queueBody.prompt["3"].inputs.sampler_name).toBe("euler");
    expect(queueBody.prompt["3"].inputs.scheduler).toBe("simple");
  });

  it("overrides hard-coded positive and negative prompt text in exported workflows", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: "prompt-text" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            "prompt-text": {
              outputs: {
                "9": {
                  images: [{ filename: "fresh.png", subfolder: "", type: "output" }],
                },
              },
            },
          }),
          { status: 200 },
        ),
      );
    const provider = new ComfyUIImageProvider({
      endpoint: "http://127.0.0.1:8188",
      workflowJson: JSON.stringify({
        "4": {
          class_type: "KSampler",
          inputs: {
            positive: ["6", 0],
            negative: ["7", 0],
          },
        },
        "6": {
          class_type: "CLIPTextEncode",
          inputs: {
            text: "old hard-coded prompt",
          },
        },
        "7": {
          class_type: "CLIPTextEncode",
          inputs: {
            text: "old hard-coded negative",
          },
        },
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1,
    });

    await provider.generateImage({
      model: "local-image",
      prompt: "very high altitude map of a ruined harbor",
      negativePrompt: "first-person view, people",
    });

    const queueBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(queueBody.prompt["6"].inputs.text).toBe("very high altitude map of a ruined harbor");
    expect(queueBody.prompt["7"].inputs.text).toBe("first-person view, people");
  });

  it("uses one resolved random seed across placeholders and sampler overrides", async () => {
    const randomSpy = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0.111)
      .mockReturnValueOnce(0.222)
      .mockReturnValueOnce(0.333);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: "prompt-seed" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            "prompt-seed": {
              outputs: {
                "9": {
                  images: [{ filename: "seed.png", subfolder: "", type: "output" }],
                },
              },
            },
          }),
          { status: 200 },
        ),
      );
    const provider = new ComfyUIImageProvider({
      endpoint: "http://127.0.0.1:8188",
      workflowJson: JSON.stringify({
        "1": {
          class_type: "KSampler",
          inputs: {
            seed: 1,
          },
        },
        "2": {
          class_type: "Note",
          inputs: {
            exactSeed: "{{seed}}",
            seedLabel: "seed={{seed}}",
          },
        },
      }),
      clientId: "test-client",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1,
    });

    try {
      await provider.generateImage({
        model: "local-image",
        prompt: "map",
        seed: -1,
      });
      expect(randomSpy).toHaveBeenCalledTimes(1);
    } finally {
      randomSpy.mockRestore();
    }

    const queueBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    const resolvedSeed = queueBody.prompt["1"].inputs.seed;
    expect(queueBody.prompt["2"].inputs.exactSeed).toBe(resolvedSeed);
    expect(queueBody.prompt["2"].inputs.seedLabel).toBe(`seed=${resolvedSeed}`);
  });

  it("treats a zero seed as random instead of repeating the same image", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.444);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: "prompt-zero-seed" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            "prompt-zero-seed": {
              outputs: {
                "9": {
                  images: [{ filename: "zero-seed.png", subfolder: "", type: "output" }],
                },
              },
            },
          }),
          { status: 200 },
        ),
      );
    const provider = new ComfyUIImageProvider({
      endpoint: "http://127.0.0.1:8188",
      workflowJson: JSON.stringify({
        "1": {
          class_type: "KSampler",
          inputs: {
            seed: "{{seed}}",
          },
        },
      }),
      clientId: "test-client",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1,
    });

    try {
      await provider.generateImage({
        model: "local-image",
        prompt: "map",
        seed: 0,
      });
      expect(randomSpy).toHaveBeenCalledTimes(1);
    } finally {
      randomSpy.mockRestore();
    }

    const queueBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(queueBody.prompt["1"].inputs.seed).toBeGreaterThan(0);
  });

  it("prefers saved output images over temporary preview images", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: "prompt-output" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            "prompt-output": {
              outputs: {
                "7": {
                  images: [{ filename: "blurry-preview.png", subfolder: "", type: "temp" }],
                },
                "9": {
                  images: [{ filename: "final-output.png", subfolder: "local-cards", type: "output" }],
                },
              },
            },
          }),
          { status: 200 },
        ),
      );
    const provider = new ComfyUIImageProvider({
      endpoint: "http://127.0.0.1:8188",
      workflowJson: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { filename_prefix: "map" } } }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1,
    });

    const result = await provider.generateImage({
      model: "local-image",
      prompt: "map",
    });

    expect(result.images[0]?.url).toBe(
      "http://127.0.0.1:8188/view?filename=final-output.png&subfolder=local-cards&type=output",
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

  it("explains browser fetch failures when ComfyUI cannot be reached", async () => {
    const provider = new ComfyUIImageProvider({
      endpoint: "http://127.0.0.1:8188",
      workflowJson: "{}",
      fetchImpl: (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch,
    });

    await expect(provider.generateImage({ model: "local-image", prompt: "map" })).rejects.toThrow(
      /Could not reach ComfyUI.*CORS enabled.*Failed to fetch/i,
    );
  });

  it("explains when ComfyUI has no installed checkpoint models", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          CheckpointLoaderSimple: {
            input: {
              required: {
                ckpt_name: [[], {}],
              },
            },
          },
        }),
        { status: 200 },
      ),
    );
    const provider = new ComfyUIImageProvider({
      endpoint: "http://127.0.0.1:8188",
      model: "juggernautXL_v9Rundiffusionphoto2.safetensors",
      workflowJson: JSON.stringify({
        "4": {
          class_type: "CheckpointLoaderSimple",
          inputs: {
            ckpt_name: "{{model}}",
          },
        },
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.generateImage({ model: "local-image", prompt: "map" })).rejects.toThrow(
      /no checkpoint models installed.*juggernautXL_v9Rundiffusionphoto2\.safetensors/i,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8188/object_info/CheckpointLoaderSimple",
      expect.any(Object),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("explains when the selected checkpoint is not in ComfyUI's installed model list", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          CheckpointLoaderSimple: {
            input: {
              required: {
                ckpt_name: [["dreamshaperXL.safetensors"], {}],
              },
            },
          },
        }),
        { status: 200 },
      ),
    );
    const provider = new ComfyUIImageProvider({
      endpoint: "http://127.0.0.1:8188",
      model: "juggernautXL_v9Rundiffusionphoto2.safetensors",
      workflowJson: JSON.stringify({
        "4": {
          class_type: "CheckpointLoaderSimple",
          inputs: {
            ckpt_name: "{{model}}",
          },
        },
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.generateImage({ model: "local-image", prompt: "map" })).rejects.toThrow(
      /checkpoint "juggernautXL_v9Rundiffusionphoto2\.safetensors" is not installed.*dreamshaperXL\.safetensors/i,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("redacts secret-like details from ComfyUI error bodies", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response("bad Authorization Bearer sk-comfy-secret-token and another_token_value_12345678901234567890", {
        status: 401,
        statusText: "Unauthorized",
      }),
    );
    const provider = new ComfyUIImageProvider({
      endpoint: "http://127.0.0.1:8188",
      apiKey: "comfy-session-key",
      workflowJson: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { text: "{{prompt}}" } } }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.generateImage({ model: "local-image", prompt: "map" })).rejects.toThrow(
      /ComfyUI queue failed \(401\): \[redacted\]/,
    );
  });

  it("binds the default browser fetch before queueing workflows", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(function (this: unknown) {
        if (this !== globalThis) {
          throw new TypeError("Illegal invocation");
        }

        return Promise.resolve(new Response(JSON.stringify({ prompt_id: "prompt-1" }), { status: 200 }));
      })
      .mockImplementationOnce(function (this: unknown) {
        if (this !== globalThis) {
          throw new TypeError("Illegal invocation");
        }

        return Promise.resolve(
          new Response(
            JSON.stringify({
              "prompt-1": {
                outputs: {
                  "9": {
                    images: [{ filename: "map.png", subfolder: "", type: "output" }],
                  },
                },
              },
            }),
            { status: 200 },
          ),
        );
      });
    vi.stubGlobal("fetch", fetchImpl);

    try {
      const provider = new ComfyUIImageProvider({
        endpoint: "http://127.0.0.1:8188",
        workflowJson: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { text: "{{prompt}}" } } }),
        pollIntervalMs: 1,
      });

      await expect(provider.generateImage({ model: "local-image", prompt: "map" })).resolves.toMatchObject({
        providerId: "comfyui",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
