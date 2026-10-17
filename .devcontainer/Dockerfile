FROM mcr.microsoft.com/devcontainers/typescript-node:24-bookworm

ADD install-vscode.sh /root/
RUN /root/install-vscode.sh

ARG VSCODE_DOWNLOAD_URL
RUN [ -n "$VSCODE_DOWNLOAD_URL" ] && cd / && wget "$VSCODE_DOWNLOAD_URL" && \
	case "$VSCODE_DOWNLOAD_URL" in \
		*.deb) dpkg -i "$(basename "$VSCODE_DOWNLOAD_URL")";; \
		*.rpm) dnf localinstall -y "$(basename "$VSCODE_DOWNLOAD_URL")";; \
		*.tar.gz) tar xfz "$(basename "$VSCODE_DOWNLOAD_URL")" ; sudo ln -s /VSCode-linux-*/code* /usr/local/bin;; \
		*) echo "Unknown filename extension: $VSCODE_DOWNLOAD_URL";; \
	esac

RUN getent passwd node || useradd --create-home --shell $SHELL node

RUN git config --system codespaces-theme.hide-status 1

USER node
RUN npm install -g node-gyp
RUN NPM_CACHE="$(npm config get cache)" && rm -rf "$NPM_CACHE" && ln -s /vscode-dev/npm-cache "$NPM_CACHE"
RUN echo 'export DISPLAY="${DISPLAY:-:1}"' | tee -a ~/.bashrc >> ~/.zshrc

USER root
CMD chown node:node /vscode-dev && sudo -u node mkdir -p /vscode-dev/npm-cache && sleep inf
