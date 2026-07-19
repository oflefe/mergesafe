const path = require('node:path');

// Unit tests mirror the src directory so unchanged relative imports stay valid.
module.exports = (request, options) => {
  try {
    return options.defaultResolver(request, options);
  } catch (error) {
    if (!request.startsWith('.')) {
      throw error;
    }

    const unitRoot = path.join(options.rootDir, 'tests', 'unit');
    const relativeDirectory = path.relative(unitRoot, options.basedir);
    if (
      relativeDirectory.startsWith('..') ||
      path.isAbsolute(relativeDirectory)
    ) {
      throw error;
    }

    return options.defaultResolver(request, {
      ...options,
      basedir: path.join(options.rootDir, 'src', relativeDirectory),
    });
  }
};
