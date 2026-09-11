export class AppHeader extends HTMLElement {
    closeDropdown = (event) => {
        if (!this.contains(event.target)) this.setDropdownOpen(false);
    };

    setDropdownOpen(isOpen) {
        const trigger = this.querySelector('#profile-trigger-btn');
        const content = this.querySelector('#dropdown-content');
        if (!trigger || !content) return;

        content.style.display = isOpen ? 'block' : 'none';
        trigger.classList.toggle('active', isOpen);
        trigger.setAttribute('aria-expanded', String(isOpen));
    }

    connectedCallback() {
        this.innerHTML = `
        <header>
            <a href="index.html" class="css-logo" style="text-decoration: none;">
                <div class="logo-text">catalog<span>d</span></div>
                <div class="logo-circles">
                    <div class="circle c-movie"></div>
                    <div class="circle c-tv"></div>
                    <div class="circle c-book"></div>
                    <div class="circle c-album"></div>
                    <div class="circle c-youtube"></div>
                </div>
            </a>
            <div class="nav-actions" style="display: flex; align-items: center; gap: 15px;">
                <button id="login-btn" class="secondary-btn" style="display:none;">Sign In</button>
                
                <a href="info.html" class="info-icon-link" aria-label="Information">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" class="bi bi-info-circle" viewBox="0 0 16 16">
                        <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
                        <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/>
                    </svg>
                </a>

                <div id="profile-menu" class="profile-dropdown" style="display:none;">
                    <button class="profile-trigger" id="profile-trigger-btn" aria-expanded="false" aria-controls="dropdown-content" aria-label="Open profile menu">
                        <img src="https://ui-avatars.com/api/?name=User&background=0d0776&color=fff" id="nav-avatar" alt="Profile">
                        <span class="dropdown-arrow"></span>
                    </button>
                    <div id="dropdown-content" class="dropdown-content" style="display: none;">
                        <a href="index.html">Home</a>
                        <a href="diary.html">Diary</a>
                        <a href="lists.html">Lists</a>
                        <a href="watchlist.html">Watchlist</a>
                        <a href="stats.html">Stats</a>
                        <a href="profile.html">Profile</a>
                        <a href="settings.html">Settings</a>
                        <hr>
                        <button id="sign-out-btn" style="background: none; border: none; color: white; padding: 12px 16px; width: 100%; text-align: left; cursor: pointer; font-family: inherit; font-size: 0.9rem;">Sign Out</button>
                    </div>
                </div>
            </div>
        </header>
        `;

        // Encapsulate Dropdown Toggle Logic natively within the component
        const trigger = this.querySelector('#profile-trigger-btn');
        const content = this.querySelector('#dropdown-content');
        
        if (trigger && content) {
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const isVisible = content.style.display === 'block';
                this.setDropdownOpen(!isVisible);
            });

            document.addEventListener('click', this.closeDropdown);
        }
    }

    disconnectedCallback() {
        document.removeEventListener('click', this.closeDropdown);
    }

    /**
     * Initializes authentication UI and returns the current user.
     * @param {Object} supabaseClient - The initialized Supabase instance.
     * @param {Function} [onLoginClick] - Optional callback for the Sign In button.
     * @returns {Object|null} The authenticated user object or null.
     */
    async initializeAuth(supabaseClient, onLoginClick) {
        const loginBtn = this.querySelector('#login-btn');
        const profileMenu = this.querySelector('#profile-menu');
        const avatar = this.querySelector('#nav-avatar');
        const signOutBtn = this.querySelector('#sign-out-btn');

        const { data: { user } } = await supabaseClient.auth.getUser();
        this.user = user; // Store internally in case needed later via document.querySelector('app-header').user

        if (user) {
            if (loginBtn) loginBtn.style.display = 'none';
            if (profileMenu) profileMenu.style.display = 'inline-block';
            if (avatar && user.user_metadata?.avatar_url) {
                try {
                    const avatarUrl = new URL(user.user_metadata.avatar_url, window.location.href);
                    if (avatarUrl.protocol === 'https:') avatar.src = avatarUrl.href;
                } catch {
                    // Ignore invalid profile avatar URLs and retain the default.
                }
            }
            
            if (signOutBtn) {
                signOutBtn.addEventListener('click', async () => {
                    await supabaseClient.auth.signOut();
                    window.location.reload();
                });
            }
        } else {
            if (loginBtn) {
                loginBtn.style.display = 'inline-block';
                loginBtn.textContent = "Sign In";
                loginBtn.addEventListener('click', () => {
                    if (onLoginClick) onLoginClick();
                    else window.location.href = 'index.html';
                });
            }
            if (profileMenu) profileMenu.style.display = 'none';
        }

        return user;
    }
}

customElements.define('app-header', AppHeader);