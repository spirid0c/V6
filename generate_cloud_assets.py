import numpy as np
from PIL import Image

def generate_fractal_noise_2d(shape):
    freqs_y = np.fft.fftfreq(shape[0])
    freqs_x = np.fft.fftfreq(shape[1])
    fx, fy = np.meshgrid(freqs_x, freqs_y)
    f = np.sqrt(fx**2 + fy**2)
    f[0,0] = 1.0 # avoid div by zero
    
    # Random phase
    np.random.seed(42) # fixed seed for consistency
    phases = np.random.rand(*shape) * 2 * np.pi
    
    # 1/f^alpha noise (pink/brown noise)
    spectrum = np.exp(1j * phases) / (f**1.8)
    spectrum[0,0] = 0
    
    noise = np.fft.ifft2(spectrum).real
    
    # Normalize 0 to 1
    noise = (noise - noise.min()) / (noise.max() - noise.min())
    return noise

print("Generating 4K Cloud Assets (4096x2048)...")
width, height = 4096, 2048

# 1. Cloud Alpha (Mask)
print("Generating Cloud Alpha...")
noise = generate_fractal_noise_2d((height, width))
# Enhance contrast to make clumps
alpha = np.clip((noise - 0.45) * 3.0, 0, 1)
alpha_img = Image.fromarray((alpha * 255).astype(np.uint8), mode='L')
alpha_img.save("cloud_alpha.png")

# 2. Cloud Color (White with some gray depth)
print("Generating Cloud Color...")
color_map = np.ones((height, width, 3), dtype=np.uint8) * 255
# Darken thicker areas slightly for depth
depth = 1.0 - alpha * 0.2
for c in range(3):
    color_map[:,:,c] = (color_map[:,:,c] * depth).astype(np.uint8)
color_img = Image.fromarray(color_map, mode='RGB')
color_img.save("cloud_color.jpg")

# 3. Cloud Normal Map
print("Generating Cloud Normal Map...")
dy, dx = np.gradient(alpha)
# Increase depth effect
dx = dx * 20.0
dy = dy * 20.0
dz = np.ones_like(dx)

# Normalize vector (dx, dy, dz)
length = np.sqrt(dx**2 + dy**2 + dz**2)
nx = dx / length
ny = dy / length
nz = dz / length

# Convert to RGB Normal Map
n_r = ((nx + 1.0) * 0.5 * 255).astype(np.uint8)
n_g = ((ny + 1.0) * 0.5 * 255).astype(np.uint8)
n_b = ((nz + 1.0) * 0.5 * 255).astype(np.uint8)

normal_map = np.stack([n_r, n_g, n_b], axis=-1)
normal_img = Image.fromarray(normal_map, mode='RGB')
normal_img.save("cloud_normal.png")

print("Done! Assets saved to workspace.")
