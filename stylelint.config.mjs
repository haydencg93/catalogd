export default {
    extends: ["stylelint-config-standard"],

    ignoreFiles: [
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/coverage/**",
        "**/*.min.css",
    ],

    rules: {
        // Color formatting
        "color-hex-length": "short",
        "color-no-invalid-hex": true,

        // Code quality
        "block-no-empty": true,
        "property-no-unknown": true,
        "unit-no-unknown": true,
        "selector-pseudo-class-no-unknown": true,
        "declaration-block-no-duplicate-properties": true,

        // Simplify unnecessary CSS
        "length-zero-no-unit": true,
        "shorthand-property-no-redundant-values": true,
        "declaration-block-no-redundant-longhand-properties": true,

        // Allow flexible naming conventions
        "selector-class-pattern": null,
        "selector-id-pattern": null,
        "custom-property-pattern": null,

        // Allow named colors and vendor-specific CSS
        "color-named": null,
        "property-no-vendor-prefix": null,
        "value-no-vendor-prefix": null,
    },
};
