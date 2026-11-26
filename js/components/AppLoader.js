// =========================================
// CATALOGD: REUSABLE COLOR CHASE LOADER
// =========================================
class AppLoader extends HTMLElement {
    constructor() {
        super();
        const shadow = this.attachShadow({
            mode: "open",
        });

        // Use Catalogd's shared media color variables.
        // Fallback colors allow the component to work
        // even without the shared stylesheet.
        const colors = [
            "var(--movie-tag, #F87171)",
            "var(--tv-tag, #38BDF8)",
            "var(--anime-tag, #FB923C)",
            "var(--book-tag, #C084FC)",
            "var(--album-tag, #F472B6)",
            "var(--game-tag, #10B981)",
            "var(--art-tag, #BE986D)",
            "var(--youtube-tag, #44ABA8)",
        ];

        const dots = colors
            .map((color, index) => {
                const angle = index * 45;
                const delay = (index * 0.175 - 1.4).toFixed(3);
                return `
                <span class="catalogd-dot"
                      style="
                          --dot-color: ${color};
                          --angle: ${angle}deg;
                          --delay: ${delay}s;
                      ">
                </span>
            `;
            })
            .join("");

        shadow.innerHTML = `
            <style>
                :host {
                    display: block;
                    width: 100%;
                    box-sizing: border-box;
                    font-family: inherit;
                }

                :host([hidden]) {
                    display: none !important;
                }

                .loader-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    box-sizing: border-box;
                }

                /* Loading and status text */
                .loader-message {
                    text-align: center;
                    color: #9ab;
                    margin: 25px auto;
                    padding: 10px 20px;
                }

                :host(.index-feed-loading) .loader-message {
                    color: var(--text, #fff);
                    font-size: 1rem;
                    font-weight: 500;
                    letter-spacing: 0.3px;
                    margin: 24px 0 45px;
                    padding: 0 20px;
                }

                /* Color Chase spinner */
                .catalogd-spinner {
                    position: relative;
                    display: none;
                    width: 80px;
                    height: 80px;
                    flex-shrink: 0;
                    margin-top: 45px;
                }

                :host(.index-feed-loading) .catalogd-spinner {
                    display: block;
                }

                /* Individual media circles */
                .catalogd-dot {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    width: 15px;
                    height: 15px;
                    border-radius: 50%;
                    background: var(--dot-color);
                    transform:
                        translate(-50%, -50%)
                        rotate(var(--angle))
                        translateY(-31px);
                    animation:
                        catalogd-color-chase
                        1.4s
                        ease-in-out
                        infinite;
                    animation-delay: var(--delay);
                }

                /* Color Chase animation */
                @keyframes catalogd-color-chase {
                    0%,
                    100% {
                        opacity: 0.3;
                        transform:
                            translate(-50%, -50%)
                            rotate(var(--angle))
                            translateY(-31px)
                            scale(0.7);
                        box-shadow: none;
                    }
                    35% {
                        opacity: 1;
                        transform:
                            translate(-50%, -50%)
                            rotate(var(--angle))
                            translateY(-31px)
                            scale(1.2);
                        box-shadow:
                            0 0 14px var(--dot-color);
                    }
                }

                /* Mobile responsiveness */
                @media (max-width: 768px) {
                    .catalogd-spinner {
                        margin-top: 30px;
                    }
                    :host(.index-feed-loading) .loader-message {
                        margin-top: 22px;
                        margin-bottom: 30px;
                        font-size: 0.95rem;
                    }
                }

                /* Reduced-motion accessibility */
                @media (prefers-reduced-motion: reduce) {
                    .catalogd-dot {
                        animation: none;
                        opacity: 1;
                        box-shadow: none;
                    }
                }
            </style>

            <div class="loader-container">
                <div class="catalogd-spinner"
                     aria-hidden="true">
                    ${dots}
                </div>
                <div class="loader-message">
                    <slot>Loading Catalogd...</slot>
                </div>
            </div>
        `;
    }

    // =========================================
    // COMPONENT INITIALIZATION
    // =========================================
    connectedCallback() {
        if (!this.hasAttribute("role")) {
            this.setAttribute("role", "status");
        }

        if (!this.hasAttribute("aria-live")) {
            this.setAttribute("aria-live", "polite");
        }
    }

    // =========================================
    // PUBLIC LOADER CONTROLS
    // =========================================
    start(message = "Loading Catalogd...") {
        this.textContent = message;
        this.hidden = false;
        this.classList.add("index-feed-loading");
        this.style.display = "block";
    }

    stop() {
        this.classList.remove("index-feed-loading");
        this.style.display = "none";
    }

    setMessage(message) {
        this.textContent = message;
    }

    showMessage(message) {
        this.classList.remove("index-feed-loading");
        this.textContent = message;
        this.hidden = false;
        this.style.display = "block";
    }

    get isLoading() {
        return (
            !this.hidden &&
            this.style.display !== "none" &&
            this.classList.contains("index-feed-loading")
        );
    }
}

// Prevent duplicate component registration.
if (!customElements.get("app-loader")) {
    customElements.define("app-loader", AppLoader);
}
