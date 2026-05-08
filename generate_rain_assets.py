import numpy as np
from PIL import Image

def generate_rain_texture(width=1024, height=1024, num_streaks=8000):
    # Start with a black image (fully transparent alpha)
    img_data = np.zeros((height, width, 4), dtype=np.float32)
    
    for _ in range(num_streaks):
        x = np.random.randint(0, width)
        y = np.random.randint(0, height)
        
        # Streak length between 20 and 150 pixels
        length = np.random.randint(20, 150)
        # Streak intensity between 50 and 255
        intensity = np.random.randint(50, 255)
        # Stroke width
        width_streak = np.random.randint(1, 3)
        
        for i in range(length):
            # Wrap around y to make it seamless vertically
            yy = (y + i) % height
            
            # Fade out at the bottom of the streak
            alpha = intensity * (1.0 - i / length)
            
            for w in range(width_streak):
                # Wrap around x to make it seamless horizontally
                xx = (x + w) % width
                
                # Set pixel (white color with varying alpha)
                img_data[yy, xx] = [255, 255, 255, alpha]
                
    # Add some overall noise for drizzle
    noise = np.random.randint(0, 30, (height, width, 4)).astype(np.float32)
    noise[:, :, 0:3] = 255 # RGB is white
    
    # Blend noise with streaks safely using float32 to prevent wrap-around
    final_data = np.clip(img_data + noise, 0, 255).astype(np.uint8)
    
    img = Image.fromarray(final_data, 'RGBA')
    img.save('rain_streaks.png')
    print("Generated rain_streaks.png successfully.")

if __name__ == '__main__':
    generate_rain_texture()
