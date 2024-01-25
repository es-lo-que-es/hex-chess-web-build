

class CopyBuffer {

   offset = 0; // ring buffer offset

   static RECT_SIZE = 16;
   static EVENT_SIZE = 56;
   static MAX_STRING_LEN = 32;
   
   // wasm modules memory is implemented as SharedArrayBuffer
   init(ibuffer, iptr, isize, obuffer) 
   {
      // offset and size of our copy buffer
      this.iptr = iptr; this.size = isize;

      // to read/write those array buffers we will need to create Uint8Array view;  
      this.iview = new Uint8Array(ibuffer);
      this.oview = new Uint8Array(obuffer);
   }
   
   // function to copy parameter into our copy buffer
   copy(ptr, sizeof, out=false) 
   {
      if ( ptr === 0 ) return 0;
      // loop ring buffer
      if ( this.offset + sizeof > this.size ) this.offset = 0;

      let copy_ptr = this.iptr + this.offset;
      // copy our data only if its input parameter since output-par should be filled by callee
      if ( !out ) this.iview.set(this.oview.subarray(ptr, ptr+sizeof), copy_ptr);

      this.offset += sizeof;

      return copy_ptr;
   }

   copy_back(ptr, copy_ptr, sizeof) 
   {
      this.oview.set(this.iview.subarray(copy_ptr, copy_ptr+sizeof), ptr);
   }
   
   oevent(ptr) { return this.copy(ptr, CopyBuffer.EVENT_SIZE, true); }

   istring(ptr) { return this.copy(ptr, CopyBuffer.MAX_STRING_LEN); }
   irect(ptr) { return this.copy(ptr, CopyBuffer.RECT_SIZE); }
   ibyte(ptr) { return this.copy(ptr, 1); }
}


async function getOdinExports(wasmPath, consoleElement, extraForeignImports)
{
   let wasmMemoryInterface = new odin.WasmMemoryInterface();
   let imports = odin.setupDefaultImports(wasmMemoryInterface, consoleElement);

   if (extraForeignImports !== undefined) imports = { ...imports, ...extraForeignImports };

   const response = await fetch(wasmPath);
   const file = await response.arrayBuffer();
   const wasm = await WebAssembly.instantiate(file, imports);

   exports = wasm.instance.exports;
   wasmMemoryInterface.setExports(exports);
   wasmMemoryInterface.setMemory(exports.memory);

   return exports;
}


let cpbuff = new CopyBuffer();

const sdl2_imports = {

   "system:SDL2_image": {
      IMG_Init: (flags) => Module._Image_Init(),
      IMG_Load: (pname) => Module._Image_Load(cpbuff.istring(pname)),
      IMG_Quit: () => Module._Image_Quit(),
   },

   "system:SDL2": {

      SDL_Init: (flags) => Module._Init(flags),
      SDL_Quit: () => Module._Quit(),

      SDL_CreateWindow: (title, x, y, w, h, flags) => Module._CreateWindow(cpbuff.istring(title), x, y, w, h, flags),
      SDL_DestroyWindow: (pwindow) => Module._DestroyWindow(pwindow),

      SDL_CreateRenderer: (pwindow, index, flags) => Module._CreateRenderer(pwindow, index, flags),
      SDL_DestroyRenderer: (prenderer) => Module._DestroyRenderer(prenderer),

      SDL_RenderFillRect: (prenderer, prect) => Module._RenderFillRect(prenderer, cpbuff.irect(prect)),
      SDL_SetRenderDrawColor: (prenderer, r, g, b, a) => Module._SetRenderDrawColor(prenderer, r, g, b, a),
      SDL_RenderPresent: (prenderer) => Module._RenderPresent(prenderer),
      SDL_RenderClear: (prenderer) => Module._RenderClear(prenderer),

      SDL_RenderCopyEx: (prenderer, ptexture, psrc, pdest, angle, center, flip) => 
         Module._RenderCopyEx(prenderer, ptexture, cpbuff.irect(psrc), cpbuff.irect(pdest), angle, center, flip),

      SDL_RenderCopy: (prenderer, ptexture, psrc, pdest) => 
         Module._RenderCopy(prenderer, ptexture, cpbuff.irect(psrc), cpbuff.irect(pdest)),

      SDL_SetTextureColorMod: (ptexture, r, g, b) => Module._SetTextureColorMod(ptexture, r, g, b),
      SDL_SetRenderTarget: (prenderer, ptexture) => Module._SetRenderTarget(prenderer, ptexture),

      SDL_CreateTexture: (prenderer, format, access, w, h) => Module._CreateTexture(prenderer, format, access, w, h),
      SDL_CreateTextureFromSurface: (prenderer, psurface) => Module._CreateTextureFromSurface(prenderer, psurface),
      SDL_DestroyTexture: (ptexture) => Module._DestroyTexture(ptexture),

      // TODO: copy error string into odin module memory
      SDL_GetError: () => Module._GetError(),
      SDL_RenderSetLogicalSize: (prenderer, w, h) => Module._RenderSetLogicalSize(prenderer, w, h),
      SDL_Delay: (ms) => Module._Delay(ms),
      SDL_FreeSurface: (psurface) => Module._FreeSurface(psurface),
      SDL_RenderDrawRect: (prenderer, prect) => Module._RenderDrawRect(prenderer, cpbuff.irect(prect)),

      // aditional handling for output parameter
      SDL_PollEvent: (pevent) => {

         let copy = cpbuff.oevent(pevent);  
         let result = Module._PollEvent(copy);
         
         cpbuff.copy_back(pevent, copy, CopyBuffer.EVENT_SIZE);

         return result;
      },

      // also output parameters
      SDL_GetRenderDrawColor: (prenderer, pr, pg, pb) => {
         
         let cr = cpbuff.ibyte(pr);
         let cg = cpbuff.ibyte(pr);
         let cb = cpbuff.ibyte(pr);

         let result = Module._GetRenderDrawColor(prenderer, cr, cg, cb);

         cpbuff.copy_back(pr, cr, 1);
         cpbuff.copy_back(pg, cg, 1);
         cpbuff.copy_back(pb, cb, 1);

         return result;
      },
   }
};


// i put main code inside async func cus js callbacks are cringe af
async function run_app() {
   
   let exports = await getOdinExports("hex-chess.wasm", {}, sdl2_imports);

   let offs = Module._get_copy_buffer();
   let size = Module._copy_buffer_size();
   cpbuff.init(Module.HEAP8.buffer, offs, size, exports.memory.buffer);
   
   exports._start();
   if ( !exports._wasm_init(exports.default_context_ptr()) ) return;
   
   function animate() {
      if ( exports._animation_frame(exports.default_context_ptr()) ) requestAnimationFrame(animate);
      else exports._end();
   }
      
   requestAnimationFrame(animate)
}

// wait for emscripten runtime to be initialised
Module.onRuntimeInitialized = () => { run_app(); }
