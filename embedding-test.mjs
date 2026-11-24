import { readFileSync, writeFileSync } from "node:fs";

const legacy = process.argv[2] === "legacy";

const { pipeline } = legacy
    ? await import("@xenova/transformers")
    : await import("@huggingface/transformers");

const model = "Xenova/all-MiniLM-L6-v2";

const samples = [
    "Action, Science Fiction, Adventure, Tony Stark",
    "Fantasy, Magic, Adventure, Harry Potter",
    "Crime, Drama, Thriller, Walter White",
];

const extractor = await pipeline(
    "feature-extraction",
    model,
    legacy ? { quantized: true } : { dtype: "q8", device: "cpu" },
);

const vectors = [];

for (const sample of samples) {
    const output = await extractor(sample, {
        pooling: "mean",
        normalize: true,
    });

    const vector = Array.from(output.data);

    vectors.push(vector);

    console.log({
        sample,
        dimensions: vector.length,
        norm: Math.hypot(...vector),
        finite: vector.every(Number.isFinite),
    });
}

if (legacy) {
    writeFileSync("embedding-baseline.json", JSON.stringify(vectors));
    console.log("Legacy baseline saved.");
} else {
    const baseline = JSON.parse(readFileSync("embedding-baseline.json", "utf8"));

    for (let i = 0; i < vectors.length; i++) {
        const a = baseline[i];
        const b = vectors[i];

        if (a.length !== b.length) {
            throw new Error("Embedding dimensions differ.");
        }

        const dot = a.reduce((sum, value, j) => sum + value * b[j], 0);

        const cosine = dot / (Math.hypot(...a) * Math.hypot(...b));

        const maxDifference = Math.max(...a.map((value, j) => Math.abs(value - b[j])));

        console.log({
            sample: samples[i],
            cosineSimilarity: cosine,
            maxDifference,
        });
    }
}

await extractor.dispose();
