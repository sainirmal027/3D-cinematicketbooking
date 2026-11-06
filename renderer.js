"use strict";

class SeatixRenderer {
    constructor(canvas, callbacks) {
        this.canvas = canvas;
        this.callbacks = callbacks;
        this.gl = canvas.getContext("webgl", { antialias: true, alpha: false });
        if (!this.gl) throw new Error("WebGL is not available in this browser.");

        this.camera = { yaw: 0, pitch: 0.24, distance: 13, target: [0, 4.9, -3.5] };
        this.seats = [];
        this.interior = null;
        this.selectedIds = new Set();
        this.drag = null;
        this.lastPointer = [0, 0];
        this.program = this.createProgram();
        this.positionLocation = this.gl.getAttribLocation(this.program, "aPosition");
        this.normalLocation = this.gl.getAttribLocation(this.program, "aNormal");
        this.colorLocation = this.gl.getAttribLocation(this.program, "aColor");
        this.textureCoordinateLocation = this.gl.getAttribLocation(this.program, "aTextureCoordinate");
        this.screenLocation = this.gl.getAttribLocation(this.program, "aScreen");
        this.matrixLocation = this.gl.getUniformLocation(this.program, "uViewProjection");
        this.movieTextureLocation = this.gl.getUniformLocation(this.program, "uMovieTexture");
        this.logoTextureLocation = this.gl.getUniformLocation(this.program, "uLogoTexture");
        this.positionBuffer = this.gl.createBuffer();
        this.normalBuffer = this.gl.createBuffer();
        this.colorBuffer = this.gl.createBuffer();
        this.textureCoordinateBuffer = this.gl.createBuffer();
        this.screenBuffer = this.gl.createBuffer();
        this.movieTexture = this.gl.createTexture();
        this.logoTexture = this.gl.createTexture();
        this.movie = null;
        this.movieImage = null;
        this.screeningVideo = null;
        this.videoAnimationFrame = null;
        this.videoCanvas = document.createElement("canvas");
        this.videoContext = this.videoCanvas.getContext("2d");
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.movieTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 1, 1, 0, this.gl.RGBA,
            this.gl.UNSIGNED_BYTE, new Uint8Array([16, 19, 26, 255]));
        this.setMovieTextureParameters();
        this.createLogoTexture();
        this.vertexCount = 0;
        this.viewportWidth = 0;
        this.viewportHeight = 0;

        this.installControls();
        this.resizeObserver = new ResizeObserver(() => this.draw());
        this.resizeObserver.observe(canvas);
        this.draw();
    }

    createProgram() {
        const gl = this.gl;
        const vertexShader = this.compileShader(gl.VERTEX_SHADER, `
            attribute vec3 aPosition;
            attribute vec3 aNormal;
            attribute vec3 aColor;
            attribute vec2 aTextureCoordinate;
            attribute float aScreen;
            uniform mat4 uViewProjection;
            varying vec3 vNormal;
            varying vec3 vColor;
            varying vec2 vTextureCoordinate;
            varying float vScreen;
            void main() {
                gl_Position = uViewProjection * vec4(aPosition, 1.0);
                vNormal = aNormal;
                vColor = aColor;
                vTextureCoordinate = aTextureCoordinate;
                vScreen = aScreen;
            }
        `);
        const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, `
            precision mediump float;
            varying vec3 vNormal;
            varying vec3 vColor;
            varying vec2 vTextureCoordinate;
            varying float vScreen;
            uniform sampler2D uMovieTexture;
            uniform sampler2D uLogoTexture;
            void main() {
                if (vScreen > 1.5) {
                    gl_FragColor = texture2D(uLogoTexture, vTextureCoordinate);
                    return;
                }
                if (vScreen > 0.5) {
                    gl_FragColor = texture2D(uMovieTexture, vTextureCoordinate);
                    return;
                }
                vec3 lightDirection = normalize(vec3(-0.45, 0.86, 0.55));
                float diffuse = max(dot(normalize(vNormal), lightDirection), 0.0);
                float lighting = 0.52 + diffuse * 0.48;
                gl_FragColor = vec4(vColor * lighting, 1.0);
            }
        `);
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(`Could not link the 3D renderer: ${gl.getProgramInfoLog(program)}`);
        }
        return program;
    }

    compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const message = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`Could not compile the 3D renderer: ${message}`);
        }
        return shader;
    }

    createLogoTexture() {
        const canvas = document.createElement("canvas");
        canvas.width = 1200;
        canvas.height = 330;
        const context = canvas.getContext("2d");
        const background = context.createLinearGradient(0, 0, canvas.width, canvas.height);
        background.addColorStop(0, "#211408");
        background.addColorStop(0.5, "#100c09");
        background.addColorStop(1, "#281707");
        context.fillStyle = background;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = "#d68b32";
        context.lineWidth = 8;
        context.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = "#f3b04f";
        context.font = "italic 900 190px Georgia, serif";
        context.fillText("S", 165, 155);
        context.strokeStyle = "#f3b04f";
        context.lineWidth = 5;
        context.beginPath();
        context.moveTo(78, 273);
        context.lineTo(252, 273);
        context.stroke();
        context.textAlign = "left";
        context.fillStyle = "#fff4df";
        context.font = "700 112px Segoe UI, Arial, sans-serif";
        context.fillText("SEATIX", 305, 143);
        context.fillStyle = "#f3b04f";
        context.font = "600 38px Segoe UI, Arial, sans-serif";
        context.letterSpacing = "15px";
        context.fillText("CINEMAS", 316, 235);

        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.logoTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    setMovie(movie) {
        this.movie = movie;
        this.movieImage = null;
        if (!this.screeningVideo) this.drawMovieScreen(movie, null);
        const image = new Image();
        image.onload = () => {
            if (this.movie === movie) {
                this.movieImage = image;
                if (!this.screeningVideo) this.drawMovieScreen(movie, image);
            }
        };
        image.onerror = () => {
            if (this.movie === movie) {
                console.error(`Could not load the ${movie.title} poster for the auditorium screen.`);
                if (!this.screeningVideo) this.drawMovieScreen(movie, null);
            }
        };
        image.src = movie.poster;
    }

    setVideo(video) {
        if (this.videoAnimationFrame !== null) {
            cancelAnimationFrame(this.videoAnimationFrame);
            this.videoAnimationFrame = null;
        }
        this.screeningVideo = video;
        if (video) {
            this.drawVideoFrame();
            this.draw();
            if (!video.paused && !video.ended) this.videoAnimationFrame = requestAnimationFrame(() => this.drawVideoFrameLoop());
        } else if (this.movie) {
            this.drawMovieScreen(this.movie, this.movieImage);
        }
    }

    drawVideoFrameLoop() {
        const video = this.screeningVideo;
        if (!video || video.paused || video.ended) {
            this.videoAnimationFrame = null;
            return;
        }
        this.drawVideoFrame();
        this.draw();
        this.videoAnimationFrame = requestAnimationFrame(() => this.drawVideoFrameLoop());
    }

    drawVideoFrame() {
        const video = this.screeningVideo;
        if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
                || !video.videoWidth || !video.videoHeight) return;

        const width = 2048;
        const height = Math.round(width / this.screenAspectRatio());
        if (this.videoCanvas.width !== width || this.videoCanvas.height !== height) {
            this.videoCanvas.width = width;
            this.videoCanvas.height = height;
        }
        this.videoContext.fillStyle = "#000";
        this.videoContext.fillRect(0, 0, width, height);
        const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
        const drawWidth = video.videoWidth * scale;
        const drawHeight = video.videoHeight * scale;
        this.videoContext.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);

        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.movieTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.videoCanvas);
        this.setMovieTextureParameters();
    }

    setMovieTextureParameters() {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.movieTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    refreshScreenTexture() {
        if (this.screeningVideo) {
            this.drawVideoFrame();
            return;
        }
        if (this.movie) this.drawMovieScreen(this.movie, this.movieImage);
    }

    drawMovieScreen(movie, image) {
        const screen = document.createElement("canvas");
        screen.width = 2048;
        screen.height = Math.round(screen.width / this.screenAspectRatio());
        const scale = screen.height / 1152;
        const context = screen.getContext("2d");
        context.fillStyle = "#10131a";
        context.fillRect(0, 0, screen.width, screen.height);

        if (image) {
            const sourceRatio = image.naturalWidth / image.naturalHeight;
            const targetRatio = screen.width / screen.height;
            const sourceWidth = sourceRatio > targetRatio ? image.naturalHeight * targetRatio : image.naturalWidth;
            const sourceHeight = sourceRatio > targetRatio ? image.naturalHeight : image.naturalWidth / targetRatio;
            const sourceX = (image.naturalWidth - sourceWidth) / 2;
            const sourceY = (image.naturalHeight - sourceHeight) / 2;
            context.filter = "blur(18px)";
            context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, screen.width, screen.height);
            context.filter = "none";
        }

        const shade = context.createLinearGradient(0, 0, screen.width, 0);
        shade.addColorStop(0, "rgba(5, 7, 11, 0.88)");
        shade.addColorStop(0.68, "rgba(5, 7, 11, 0.58)");
        shade.addColorStop(1, "rgba(5, 7, 11, 0.36)");
        context.fillStyle = shade;
        context.fillRect(0, 0, screen.width, screen.height);
        if (image) {
            const posterHeight = screen.height * 0.86;
            const posterWidth = posterHeight * image.naturalWidth / image.naturalHeight;
            const posterX = screen.width - posterWidth - screen.width * 0.0234;
            context.drawImage(image, posterX, screen.height * 0.066, posterWidth, posterHeight);
        }
        context.fillStyle = "#c9f25a";
        context.font = `700 ${42 * scale}px Segoe UI, Arial, sans-serif`;
        context.fillText("SEATIX  ·  NOW SHOWING", screen.width * 0.047, screen.height * 0.135);
        context.fillStyle = "#ffffff";
        let titleSize = 132 * scale;
        context.font = `700 ${titleSize}px Segoe UI, Arial, sans-serif`;
        while (context.measureText(movie.title).width > screen.width * 0.58 && titleSize > 52 * scale) {
            titleSize -= 2 * scale;
            context.font = `700 ${titleSize}px Segoe UI, Arial, sans-serif`;
        }
        context.fillText(movie.title, screen.width * 0.047, screen.height * 0.469);
        context.fillStyle = "rgba(255, 255, 255, 0.78)";
        context.font = `500 ${34 * scale}px Segoe UI, Arial, sans-serif`;
        context.fillText("EXPERIENCE THE MOVIE IN 3D", screen.width * 0.049, screen.height * 0.538);

        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.movieTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, screen);
        this.setMovieTextureParameters();
        this.draw();
    }

    setSeats(seats) {
        this.seats = seats;
        this.selectedIds.clear();
        this.camera = this.defaultCamera();
        this.buildGeometry();
        this.refreshScreenTexture();
        this.draw();
    }

    setSelectedSeats(ids) {
        this.selectedIds = new Set(ids);
        this.buildGeometry();
        this.draw();
    }

    setInterior(interior) {
        this.interior = interior;
        this.buildGeometry();
        this.refreshScreenTexture();
        this.draw();
    }

    buildGeometry() {
        const positions = [];
        const normals = [];
        const colors = [];
        const textureCoordinates = [];
        const screenVertices = [];
        const wall = hexToRgb(this.interior?.wallColor ?? "#19130F");
        const ceiling = hexToRgb(this.interior?.ceilingColor ?? "#090807");
        const trim = hexToRgb(this.interior?.trimColor ?? "#70431E");
        const accent = hexToRgb(this.interior?.accentColor ?? "#EFA23A");
        const aisleLight = hexToRgb(this.interior?.aisleLightColor ?? "#FFC05B");
        const rearWall = hexToRgb("#100C09");
        this.addBox(positions, normals, colors, textureCoordinates, screenVertices, 0, -0.29, 1.2, 35, 0.58, 31, [0.09, 0.075, 0.06]);
        this.addBox(positions, normals, colors, textureCoordinates, screenVertices, 0, 7.9, -14.35, 35, 15.8, 0.48, wall);
        this.addBox(positions, normals, colors, textureCoordinates, screenVertices, 0, 7.9, 16.7, 35, 15.8, 0.48, rearWall);
        this.addBox(positions, normals, colors, textureCoordinates, screenVertices, -17.25, 7.9, 1.2, 0.5, 15.8, 31, wall);
        this.addBox(positions, normals, colors, textureCoordinates, screenVertices, 17.25, 7.9, 1.2, 0.5, 15.8, 31, wall);
        this.addBox(positions, normals, colors, textureCoordinates, screenVertices, 0, 15.8, 1.2, 35, 0.5, 31, ceiling);
        this.addBox(positions, normals, colors, textureCoordinates, screenVertices, 0, 0.12, -12.1, 25, 0.38, 4.1, trim);
        this.addRoomInterior(positions, normals, colors, textureCoordinates, screenVertices, trim, accent, aisleLight);
        this.addRearWallDetails(positions, normals, colors, textureCoordinates, screenVertices, trim, accent, rearWall);
        this.addSeatPlatforms(positions, normals, colors, textureCoordinates, screenVertices, trim, aisleLight);
        this.addSeatixLogo(positions, normals, colors, textureCoordinates, screenVertices, trim);
        this.addCurvedScreen(positions, normals, colors, textureCoordinates, screenVertices);

        if (this.seats.some((seat) => seat.section === "Balcony")) {
            this.addBox(positions, normals, colors, textureCoordinates, screenVertices, 0, 3.58, 1.2, 28, 0.32, 6.7, [0.17, 0.18, 0.23]);
            this.addBox(positions, normals, colors, textureCoordinates, screenVertices, 0, 3.80, 4.65, 28, 0.11, 0.18, [0.42, 0.46, 0.53]);
        }

        for (const seat of this.seats) {
            const base = seat.unavailable ? [0.82, 0.24, 0.29]
                : this.selectedIds.has(seat.id) ? [1.0, 0.39, 0.13]
                    : seat.category === "premium" ? [0.96, 0.76, 0.22]
                        : hexToRgb(this.interior?.seatColor ?? "#1A1715")
                            .map((value) => Math.min(0.42, value * 1.7 + 0.05));
            const back = base.map((value) => Math.min(1, value * 1.16));
            const frame = trim;
            this.addBox(positions, normals, colors, textureCoordinates, screenVertices, seat.x, seat.y + 0.47, seat.z, 0.54, 0.15, 0.54, base);
            this.addBox(positions, normals, colors, textureCoordinates, screenVertices, seat.x, seat.y + 0.86, seat.z + 0.20, 0.54, 0.66, 0.14, back);
            this.addBox(positions, normals, colors, textureCoordinates, screenVertices, seat.x - 0.32, seat.y + 0.58, seat.z, 0.09, 0.20, 0.57, frame);
            this.addBox(positions, normals, colors, textureCoordinates, screenVertices, seat.x + 0.32, seat.y + 0.58, seat.z, 0.09, 0.20, 0.57, frame);
            this.addBox(positions, normals, colors, textureCoordinates, screenVertices, seat.x, seat.y + 0.22, seat.z + 0.04, 0.15, 0.33, 0.15, frame);
        }

        this.vertexCount = positions.length / 3;
        this.uploadBuffer(this.positionBuffer, positions, this.positionLocation);
        this.uploadBuffer(this.normalBuffer, normals, this.normalLocation);
        this.uploadBuffer(this.colorBuffer, colors, this.colorLocation);
        this.uploadBuffer(this.textureCoordinateBuffer, textureCoordinates, this.textureCoordinateLocation, 2);
        this.uploadBuffer(this.screenBuffer, screenVertices, this.screenLocation, 1);
    }

    addRoomInterior(positions, normals, colors, textureCoordinates, screenVertices, trim, accent, aisleLight) {
        const addBox = (x, y, z, width, height, depth, color) => {
            this.addBox(positions, normals, colors, textureCoordinates, screenVertices,
                x, y, z, width, height, depth, color);
        };
        const slatCount = this.interior?.wallSlatCount ?? 20;
        for (const side of [-1, 1]) {
            for (let index = 0; index < slatCount; index++) {
                const z = -12.1 + 27 * index / Math.max(1, slatCount - 1);
                const isLight = index % 4 === 1;
                addBox(side * 16.91, 7.8, z, 0.12, 15.1, 0.16, isLight ? accent : trim);
            }
            for (const z of [-8, -2, 4, 10]) {
                addBox(side * 16.88, 4.7, z, 0.11, 0.72, 0.36, aisleLight);
                addBox(side * 16.87, 2.0, z, 0.12, 3.3, 1.65, [0.055, 0.045, 0.035]);
                addBox(side * 16.78, 3.72, z - 0.88, 0.15, 3.5, 0.13, trim);
                addBox(side * 16.78, 3.72, z + 0.88, 0.15, 3.5, 0.13, trim);
                addBox(side * 16.78, 5.42, z, 0.15, 0.13, 1.78, trim);
            }
        }

        addBox(0, 15.55, -13.0, 33.6, 0.09, 0.12, accent);
        addBox(0, 15.55, 15.2, 33.6, 0.09, 0.12, accent);
        addBox(-16.55, 15.55, 1.1, 0.12, 0.09, 28.1, accent);
        addBox(16.55, 15.55, 1.1, 0.12, 0.09, 28.1, accent);

        const starCount = this.interior?.ceilingStarCount ?? 180;
        const columns = 15;
        const rows = Math.ceil(starCount / columns);
        for (let index = 0; index < starCount; index++) {
            const column = index % columns;
            const row = Math.floor(index / columns);
            const x = -13.2 + column * 1.88;
            const z = -10.8 + row * (24.5 / Math.max(rows - 1, 1));
            addBox(x, 15.48, z, 0.09, 0.04, 0.09, index % 5 === 0 ? aisleLight : accent);
        }

        const ringCount = this.interior?.ringLightCount ?? 2;
        for (let index = 0; index < ringCount; index++) {
            const radiusX = 4.5 - index * 1.25;
            const radiusZ = 2.25 - index * 0.62;
            this.addEllipseRing(positions, normals, colors, textureCoordinates, screenVertices,
                0, 14.95, 0.8, radiusX, radiusZ, 0.16, index === 0 ? aisleLight : accent);
        }

        addBox(0, 0.24, -12.65, 26, 0.42, 2.1, [0.09, 0.065, 0.045]);
        addBox(0, 0.48, -11.65, 25.8, 0.07, 0.09, accent);
        addBox(-13.8, 0.22, -10.9, 0.9, 0.44, 0.9, trim);
        addBox(13.8, 0.22, -10.9, 0.9, 0.44, 0.9, trim);
    }

    addSeatPlatforms(positions, normals, colors, textureCoordinates, screenVertices, trim, aisleLight) {
        const rowGroups = new Map();
        for (const seat of this.seats) {
            const rowKey = `${seat.section}:${seat.row}`;
            let row = rowGroups.get(rowKey);
            if (!row) {
                row = { y: seat.y, zTotal: 0, count: 0, blocks: new Map() };
                rowGroups.set(rowKey, row);
            }
            row.zTotal += seat.z;
            row.count++;

            const block = seat.x < -5.5 ? "left" : seat.x < 6.5 ? "center" : "right";
            let platform = row.blocks.get(block);
            if (!platform) {
                platform = { minX: seat.x, maxX: seat.x, minZ: seat.z, maxZ: seat.z };
                row.blocks.set(block, platform);
            }
            platform.minX = Math.min(platform.minX, seat.x);
            platform.maxX = Math.max(platform.maxX, seat.x);
            platform.minZ = Math.min(platform.minZ, seat.z);
            platform.maxZ = Math.max(platform.maxZ, seat.z);
        }

        const orderedRows = [...rowGroups.values()].sort((first, second) =>
            first.zTotal / first.count - second.zTotal / second.count);
        const previousPlatformTops = new Map();
        const previousAisleTops = new Map();
        const addPlatform = (x, y, z, width, height, depth, color) => {
            this.addBox(positions, normals, colors, textureCoordinates, screenVertices,
                x, y, z, width, height, depth, color);
        };
        for (const row of orderedRows) {
            const platformTop = row.y + 0.055;
            const rowZ = row.zTotal / row.count;
            for (const [platformKey, platform] of row.blocks) {
                const width = platform.maxX - platform.minX + 0.72;
                const depth = Math.max(0.68, platform.maxZ - platform.minZ + 0.52);
                const centerX = (platform.minX + platform.maxX) / 2;
                const centerZ = (platform.minZ + platform.maxZ) / 2;
                const previousTop = previousPlatformTops.get(platformKey) ?? 0;
                const isFirstRow = !previousPlatformTops.has(platformKey);
                const treadHeight = isFirstRow ? platformTop : 0.12;
                addPlatform(centerX, platformTop - treadHeight / 2, centerZ, width, treadHeight, depth,
                    [0.095, 0.073, 0.052]);
                if (!isFirstRow) {
                    addPlatform(centerX, (platformTop + previousTop) / 2,
                        centerZ - depth / 2, width, platformTop - previousTop, 0.07, [0.12, 0.085, 0.052]);
                }
                addPlatform(centerX, platformTop - 0.035, centerZ - depth / 2, width, 0.045, 0.045, trim);
                previousPlatformTops.set(platformKey, platformTop);
            }
            for (const x of [-6.0, 5.0]) {
                const previousTop = previousAisleTops.get(x) ?? 0;
                const isFirstRow = !previousAisleTops.has(x);
                const treadHeight = isFirstRow ? platformTop : 0.12;
                addPlatform(x, platformTop - treadHeight / 2, rowZ, 1.15, treadHeight, 0.68, [0.07, 0.055, 0.04]);
                if (!isFirstRow) {
                    addPlatform(x, (platformTop + previousTop) / 2, rowZ - 0.36,
                        1.15, platformTop - previousTop, 0.07, [0.11, 0.078, 0.045]);
                }
                addPlatform(x, platformTop + 0.025, rowZ - 0.29, 1.15, 0.04, 0.055, aisleLight);
                previousAisleTops.set(x, platformTop);
            }
        }
    }

    addSeatixLogo(positions, normals, colors, textureCoordinates, screenVertices, trim) {
        const centerX = -14.5;
        const centerY = 9.2;
        const wallZ = -13.88;
        const width = 4.4;
        const height = 1.2;
        this.addBox(positions, normals, colors, textureCoordinates, screenVertices,
            centerX, centerY, wallZ - 0.08, width + 0.24, height + 0.24, 0.12, trim);
        const left = centerX - width / 2;
        const right = centerX + width / 2;
        const bottom = centerY - height / 2;
        const top = centerY + height / 2;
        const frontZ = wallZ;
        const lowerLeft = [left, bottom, frontZ];
        const lowerRight = [right, bottom, frontZ];
        const upperLeft = [left, top, frontZ];
        const upperRight = [right, top, frontZ];
        this.addTriangle(positions, normals, colors, textureCoordinates, screenVertices,
            lowerLeft, lowerRight, upperLeft, [1, 1, 1],
            [[0, 1], [1, 1], [0, 0]], 2);
        this.addTriangle(positions, normals, colors, textureCoordinates, screenVertices,
            lowerRight, upperRight, upperLeft, [1, 1, 1],
            [[1, 1], [1, 0], [0, 0]], 2);
    }

    addRearWallDetails(positions, normals, colors, textureCoordinates, screenVertices, trim, accent, rearWall) {
        const addBox = (x, y, z, width, height, depth, color) => {
            this.addBox(positions, normals, colors, textureCoordinates, screenVertices,
                x, y, z, width, height, depth, color);
        };
        const wallFace = 16.42;
        const frameDepth = 0.12;
        addBox(0, 9.2, wallFace, 8.4, 3.15, frameDepth, rearWall);
        addBox(0, 9.2, wallFace - 0.09, 7.9, 2.56, 0.06, [0.025, 0.02, 0.018]);
        for (const x of [-4.25, 4.25]) {
            addBox(x, 9.2, wallFace - 0.08, 0.18, 3.35, 0.16, trim);
        }
        for (const y of [7.54, 10.86]) {
            addBox(0, y, wallFace - 0.08, 8.5, 0.18, 0.16, trim);
        }
        addBox(0, 9.2, wallFace - 0.19, 0.46, 0.46, 0.12, accent);
        addBox(0, 9.2, wallFace - 0.27, 0.17, 0.17, 0.08, [1.0, 0.74, 0.43]);

        addBox(12.3, 4.0, wallFace, 4.2, 7.0, 0.18, trim);
        addBox(12.3, 4.0, wallFace - 0.12, 3.75, 6.55, 0.08, [0.045, 0.035, 0.028]);
        addBox(11.25, 4.0, wallFace - 0.2, 0.12, 5.95, 0.1, accent);
        addBox(13.45, 4.0, wallFace - 0.2, 0.12, 5.95, 0.1, trim);
        addBox(13.4, 3.8, wallFace - 0.29, 0.09, 0.8, 0.08, accent);

        for (const x of [-15.6, -13.6, -11.6, 11.6, 13.6, 15.6]) {
            addBox(x, 8.0, wallFace - 0.08, 0.08, 14.8, 0.1, trim);
        }
        addBox(0, 15.48, -0.1, 0.12, 0.07, 27.5, accent);
        addBox(-8.2, 15.48, 0.1, 0.08, 0.07, 27.5, trim);
        addBox(8.2, 15.48, 0.1, 0.08, 0.07, 27.5, trim);
    }

    addEllipseRing(positions, normals, colors, textureCoordinates, screenVertices,
                   centerX, y, centerZ, radiusX, radiusZ, thickness, color) {
        const segments = 64;
        for (let index = 0; index < segments; index++) {
            const firstAngle = 2 * Math.PI * index / segments;
            const secondAngle = 2 * Math.PI * (index + 1) / segments;
            const point = (angle, radiusOffset) => [
                centerX + (radiusX + radiusOffset) * Math.cos(angle),
                y,
                centerZ + (radiusZ + radiusOffset) * Math.sin(angle)
            ];
            const outerFirst = point(firstAngle, thickness / 2);
            const innerFirst = point(firstAngle, -thickness / 2);
            const outerSecond = point(secondAngle, thickness / 2);
            const innerSecond = point(secondAngle, -thickness / 2);
            this.addTriangle(positions, normals, colors, textureCoordinates, screenVertices,
                outerFirst, innerFirst, outerSecond, color);
            this.addTriangle(positions, normals, colors, textureCoordinates, screenVertices,
                innerFirst, innerSecond, outerSecond, color);
        }
    }

    uploadBuffer(buffer, data, location, components = 3) {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, components, gl.FLOAT, false, 0, 0);
    }

    addCurvedScreen(positions, normals, colors, textureCoordinates, screenVertices) {
        const segments = 36;
        const radius = 30;
        const halfAngle = 0.42;
        const screenWidth = radius * 2 * Math.sin(halfAngle);
        const screenHeight = screenWidth / this.screenAspectRatio();
        const screenBottom = 1.6;
        const screenTop = screenBottom + screenHeight;
        const screenColor = [0.83, 0.89, 0.97];
        for (let index = 0; index < segments; index++) {
            const leftAngle = -halfAngle + 2 * halfAngle * index / segments;
            const rightAngle = -halfAngle + 2 * halfAngle * (index + 1) / segments;
            const point = (angle, y) => [radius * Math.sin(angle), y, -14.1 + radius * (1 - Math.cos(angle))];
            const bottomLeft = point(leftAngle, screenBottom);
            const topLeft = point(leftAngle, screenTop);
            const bottomRight = point(rightAngle, screenBottom);
            const topRight = point(rightAngle, screenTop);
            const left = index / segments;
            const right = (index + 1) / segments;
            this.addTriangle(positions, normals, colors, textureCoordinates, screenVertices,
                bottomLeft, bottomRight, topLeft, screenColor, [[left, 0], [right, 0], [left, 1]]);
            this.addTriangle(positions, normals, colors, textureCoordinates, screenVertices,
                bottomRight, topRight, topLeft, screenColor, [[right, 0], [right, 1], [left, 1]]);
        }
    }

    screenAspectRatio() {
        return this.interior?.aspectRatio
            ?? (this.seats.some((seat) => seat.section === "IMAX") ? 16 / 9 : 2.35);
    }

    addBox(positions, normals, colors, textureCoordinates, screenVertices, x, y, z, width, height, depth, color) {
        const x0 = x - width / 2;
        const x1 = x + width / 2;
        const y0 = y - height / 2;
        const y1 = y + height / 2;
        const z0 = z - depth / 2;
        const z1 = z + depth / 2;
        const faces = [
            [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
            [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]],
            [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
            [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]],
            [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
            [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]
        ];
        for (const [first, second, third, fourth] of faces) {
            this.addTriangle(positions, normals, colors, textureCoordinates, screenVertices, first, second, third, color);
            this.addTriangle(positions, normals, colors, textureCoordinates, screenVertices, first, third, fourth, color);
        }
    }

    addTriangle(positions, normals, colors, textureCoordinates, screenVertices,
                first, second, third, color, textureUV = null, textureMode = 1) {
        const edgeA = [second[0] - first[0], second[1] - first[1], second[2] - first[2]];
        const edgeB = [third[0] - first[0], third[1] - first[1], third[2] - first[2]];
        const normal = normalize([
            edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
            edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
            edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0]
        ]);
        const vertices = [first, second, third];
        for (let index = 0; index < vertices.length; index++) {
            const vertex = vertices[index];
            positions.push(vertex[0], vertex[1], vertex[2]);
            normals.push(normal[0], normal[1], normal[2]);
            colors.push(color[0], color[1], color[2]);
            textureCoordinates.push(...(textureUV ? textureUV[index] : [0, 0]));
            screenVertices.push(textureUV ? textureMode : 0);
        }
    }

    installControls() {
        this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
        this.canvas.addEventListener("pointerdown", (event) => {
            this.canvas.setPointerCapture(event.pointerId);
            this.drag = {
                x: event.clientX,
                y: event.clientY,
                button: event.button,
                moved: false
            };
            this.lastPointer = [event.clientX, event.clientY];
        });
        this.canvas.addEventListener("pointermove", (event) => {
            if (!this.drag) {
                const hoveredSeat = this.pickSeat(event.clientX, event.clientY);
                this.canvas.style.cursor = hoveredSeat ? "pointer" : "grab";
                this.callbacks.onSeatHover?.(hoveredSeat);
                return;
            }
            const dx = event.clientX - this.lastPointer[0];
            const dy = event.clientY - this.lastPointer[1];
            this.lastPointer = [event.clientX, event.clientY];
            if (Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y) > 4) this.drag.moved = true;
            if (this.drag.button === 0) {
                const fullTurn = Math.PI * 2;
                this.camera.yaw = ((this.camera.yaw - dx * 0.006 + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
                this.camera.pitch = clamp(this.camera.pitch + dy * 0.005, 0.08, 0.62);
                this.draw();
            } else if (this.drag.button === 2) {
                this.pan(dx, dy);
                this.draw();
            }
        });
        this.canvas.addEventListener("pointerup", (event) => {
            const drag = this.drag;
            this.drag = null;
            if (drag && !drag.moved && drag.button === 0) {
                const clickedSeat = this.pickSeat(event.clientX, event.clientY);
                if (clickedSeat) this.callbacks.onSeatClick?.(clickedSeat);
            }
        });
        this.canvas.addEventListener("pointercancel", () => { this.drag = null; });
        this.canvas.addEventListener("pointerleave", () => {
            if (!this.drag) this.callbacks.onSeatHover?.(null);
        });
        this.canvas.addEventListener("wheel", (event) => {
            event.preventDefault();
            this.zoom(event.deltaY > 0 ? 2 : -2);
        }, { passive: false });
    }

    pan(dx, dy) {
        const forward = normalize(subtract(this.camera.target, this.eyePosition()));
        const right = normalize(cross(forward, [0, 1, 0]));
        const up = normalize(cross(right, forward));
        const unitsPerPixel = this.camera.distance / Math.max(this.canvas.clientHeight, 1);
        this.camera.target = add(this.camera.target, scale(right, -dx * unitsPerPixel));
        this.camera.target = add(this.camera.target, scale(up, dy * unitsPerPixel));
        this.camera.target[0] = clamp(this.camera.target[0], -0.5, 0.5);
        this.camera.target[1] = clamp(this.camera.target[1], 4.2, 5.6);
        this.camera.target[2] = clamp(this.camera.target[2], -0.5, 0.5);
    }

    zoom(amount) {
        this.camera.distance = clamp(this.camera.distance + amount, 8, 13);
        this.draw();
    }

    resetCamera() {
        this.camera = this.defaultCamera();
        this.draw();
    }

    defaultCamera() {
        if (this.seats.some((seat) => seat.section === "IMAX")) {
            return { yaw: 0, pitch: 0.42, distance: 13, target: [0, 6.8, 1.8] };
        }
        return this.seats.some((seat) => seat.section === "Balcony")
            ? { yaw: 0, pitch: 0.24, distance: 13, target: [0, 5.4, 0] }
            : { yaw: 0, pitch: 0.24, distance: 13, target: [0, 4.9, 0] };
    }

    eyePosition() {
        const { yaw, pitch, distance, target } = this.camera;
        return [
            target[0] + distance * Math.sin(yaw) * Math.cos(pitch),
            target[1] + distance * Math.sin(pitch),
            target[2] + distance * Math.cos(yaw) * Math.cos(pitch)
        ];
    }

    pickSeat(clientX, clientY) {
        const rectangle = this.canvas.getBoundingClientRect();
        if (rectangle.width === 0 || rectangle.height === 0) return null;
        const x = ((clientX - rectangle.left) / rectangle.width) * 2 - 1;
        const y = 1 - ((clientY - rectangle.top) / rectangle.height) * 2;
        const aspect = rectangle.width / rectangle.height;
        const forward = normalize(subtract(this.camera.target, this.eyePosition()));
        const right = normalize(cross(forward, [0, 1, 0]));
        const up = normalize(cross(right, forward));
        const tangent = Math.tan(Math.PI / 8);
        const ray = normalize(add(add(forward, scale(right, x * tangent * aspect)), scale(up, y * tangent)));
        const origin = this.eyePosition();
        let closest = Infinity;
        let result = null;
        for (const seat of this.seats) {
            const hit = hitBox(
                origin,
                ray,
                [seat.x - 0.45, seat.y + 0.12, seat.z - 0.38],
                [seat.x + 0.45, seat.y + 1.22, seat.z + 0.42]
            );
            if (hit !== null && hit < closest) {
                closest = hit;
                result = seat;
            }
        }
        return result;
    }

    draw() {
        const gl = this.gl;
        const rectangle = this.canvas.getBoundingClientRect();
        if (!rectangle.width || !rectangle.height) return;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.round(rectangle.width * pixelRatio);
        const height = Math.round(rectangle.height * pixelRatio);
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        if (width !== this.viewportWidth || height !== this.viewportHeight) {
            this.viewportWidth = width;
            this.viewportHeight = height;
            gl.viewport(0, 0, width, height);
        }

        gl.clearColor(0.035, 0.03, 0.026, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(this.program);

        const eye = this.eyePosition();
        const projection = perspective(Math.PI / 4, width / height, 0.1, 140);
        const view = lookAt(eye, this.camera.target, [0, 1, 0]);
        const viewProjection = multiply(projection, view);
        gl.uniformMatrix4fv(this.matrixLocation, false, viewProjection);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.vertexAttribPointer(this.positionLocation, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
        gl.vertexAttribPointer(this.normalLocation, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.vertexAttribPointer(this.colorLocation, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.textureCoordinateBuffer);
        gl.vertexAttribPointer(this.textureCoordinateLocation, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.screenBuffer);
        gl.vertexAttribPointer(this.screenLocation, 1, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.movieTexture);
        gl.uniform1i(this.movieTextureLocation, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.logoTexture);
        gl.uniform1i(this.logoTextureLocation, 1);
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    }
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function hexToRgb(color) {
    const value = Number.parseInt(color.slice(1), 16);
    return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
}

function add(first, second) {
    return [first[0] + second[0], first[1] + second[1], first[2] + second[2]];
}

function subtract(first, second) {
    return [first[0] - second[0], first[1] - second[1], first[2] - second[2]];
}

function scale(vector, amount) {
    return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

function cross(first, second) {
    return [
        first[1] * second[2] - first[2] * second[1],
        first[2] * second[0] - first[0] * second[2],
        first[0] * second[1] - first[1] * second[0]
    ];
}

function normalize(vector) {
    const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
    return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function perspective(fieldOfView, aspect, near, far) {
    const focalLength = 1 / Math.tan(fieldOfView / 2);
    const range = 1 / (near - far);
    return new Float32Array([
        focalLength / aspect, 0, 0, 0,
        0, focalLength, 0, 0,
        0, 0, (near + far) * range, -1,
        0, 0, 2 * near * far * range, 0
    ]);
}

function lookAt(eye, target, upDirection) {
    const backward = normalize(subtract(eye, target));
    const right = normalize(cross(upDirection, backward));
    const up = cross(backward, right);
    return new Float32Array([
        right[0], up[0], backward[0], 0,
        right[1], up[1], backward[1], 0,
        right[2], up[2], backward[2], 0,
        -dot(right, eye), -dot(up, eye), -dot(backward, eye), 1
    ]);
}

function dot(first, second) {
    return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function multiply(first, second) {
    const result = new Float32Array(16);
    for (let column = 0; column < 4; column++) {
        for (let row = 0; row < 4; row++) {
            result[column * 4 + row] =
                first[row] * second[column * 4]
                + first[4 + row] * second[column * 4 + 1]
                + first[8 + row] * second[column * 4 + 2]
                + first[12 + row] * second[column * 4 + 3];
        }
    }
    return result;
}

function hitBox(origin, direction, minimum, maximum) {
    let near = -Infinity;
    let far = Infinity;
    for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(direction[axis]) < 1e-8) {
            if (origin[axis] < minimum[axis] || origin[axis] > maximum[axis]) return null;
            continue;
        }
        let first = (minimum[axis] - origin[axis]) / direction[axis];
        let second = (maximum[axis] - origin[axis]) / direction[axis];
        if (first > second) [first, second] = [second, first];
        near = Math.max(near, first);
        far = Math.min(far, second);
        if (near > far) return null;
    }
    return far < 0 ? null : Math.max(0, near);
}
