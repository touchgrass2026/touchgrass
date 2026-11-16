/**
 * The lazy photo-library loader (D-218): phones on an APK from before D-218 get this JavaScript over the air
 * but have no native module, so loading must answer null there instead of crashing.
 */
type Loader = typeof import('../src/features/after/media-library');

function loadWith(nativeModule: object | null, failing = false): Loader {
  let loader: Loader | undefined;
  jest.isolateModules(() => {
    jest.doMock('expo', () => ({
      requireOptionalNativeModule: jest.fn(() => {
        if (failing) throw new Error('native registry unavailable');
        return nativeModule;
      }),
    }));
    loader = jest.requireActual<Loader>('../src/features/after/media-library');
  });
  if (!loader) throw new Error('loader not loaded');
  return loader;
}

describe('photo library loader (D-218)', () => {
  afterEach(() => {
    jest.dontMock('expo');
  });

  it('loads the module when the build has it, once', () => {
    const loader = loadWith({});
    const first = loader.mediaLibrary();
    expect(first).not.toBeNull();
    expect(typeof first?.saveToLibraryAsync).toBe('function');
    expect(loader.mediaLibrary()).toBe(first);
  });

  it('answers null on builds without it, or when the lookup itself fails', () => {
    expect(loadWith(null).mediaLibrary()).toBeNull();
    const broken = loadWith({}, true);
    expect(broken.mediaLibrary()).toBeNull();
    broken.resetMediaLibraryForTests();
    expect(broken.mediaLibrary()).toBeNull();
  });
});
