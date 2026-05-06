const Problem = require("../models/Problem");

function ownershipFilter(req, problemId) {
    const filter = { _id: problemId };
    if (req.user?.role === 'teacher') filter.createdBy = req.user._id;
    return filter;
}

/**
 * Get all coding problems - public view for students/users
 */
exports.getAllProblems = async (req, res) => {
    try {
        // Fetch all problems from database, sorted by creation date
        const problems = await Problem.find({}).sort('-createdAt');
        
        // Render the problems list view
        res.render("problems/index", { 
            title: "Coding Problems",
            problems 
        });
    } catch (error) {
        // Log error and display error page
        console.error('Error fetching problems:', error);
        req.flash('error', 'Failed to load problems');
        res.redirect('/');
    }
};

/**
 * Get a single problem by ID - public view for code editor
 */
exports.getSingleProblem = async (req, res) => {
    try {
        // Fetch specific problem by ID
        const problem = await Problem.findById(req.params.id);
        
        // Check if problem exists
        if (!problem) {
            req.flash('error', 'Problem not found');
            return res.redirect('/problems');
        }
        
        // Render the problem view with code editor
        res.render("problems/show", { 
            title: problem.title,
            problem 
        });
    } catch (error) {
        // Log error and display error page
        console.error('Error fetching problem:', error);
        req.flash('error', 'Failed to load problem');
        res.redirect('/problems');
    }
};

/**
 * Show problem creation form - admin only
 */
exports.showCreateProblem = async (req, res) => {
    try {
        res.render("problems/form", {
            title: "Create Problem",
            problem: {},
            action: "/problems/create",
            isEdit: false
        });
    } catch (error) {
        console.error('Error loading create form:', error);
        req.flash('error', 'Failed to load form');
        res.redirect('/problems/manage');
    }
};

/**
 * Create a new problem - admin only
 */
exports.createProblem = async (req, res) => {
    try {
        // Extract form data
        const { title, description, inputFormat, outputFormat, sampleInput, sampleOutput, difficulty } = req.body;

        // Validate required fields
        if (!title || !description || !difficulty) {
            req.flash('error', 'Title, description, and difficulty are required');
            return res.redirect('/problems/create/new');
        }

        // Parse test cases from form
        const testCases = parseTestCases(req.body);

        // Create new problem
        const problem = await Problem.create({
            title,
            description,
            inputFormat,
            outputFormat,
            sampleInput,
            sampleOutput,
            difficulty,
            testCases,
            createdBy: req.user._id // Track who created it
        });

        req.flash('success', `Problem "${title}" created successfully!`);
        res.redirect(`/problems/${problem._id}`);
    } catch (error) {
        console.error('Error creating problem:', error);
        req.flash('error', 'Failed to create problem');
        res.redirect('/problems/create/new');
    }
};

/**
 * Show problem edit form - admin only
 */
exports.showEditProblem = async (req, res) => {
    try {
        const problem = await Problem.findOne(ownershipFilter(req, req.params.id));

        if (!problem) {
            req.flash('error', 'Problem not found or you do not have permission to edit it.');
            return res.redirect('/problems/manage');
        }

        res.render("problems/form", {
            title: `Edit: ${problem.title}`,
            problem,
            action: `/problems/${problem._id}/edit?_method=PUT`,
            isEdit: true
        });
    } catch (error) {
        console.error('Error loading edit form:', error);
        req.flash('error', 'Failed to load problem');
        res.redirect('/problems/manage');
    }
};

/**
 * Update problem - admin only
 */
exports.updateProblem = async (req, res) => {
    try {
        const { title, description, inputFormat, outputFormat, sampleInput, sampleOutput, difficulty } = req.body;

        // Validate required fields
        if (!title || !description || !difficulty) {
            req.flash('error', 'Title, description, and difficulty are required');
            return res.redirect(`/problems/${req.params.id}/edit`);
        }

        // Parse test cases
        const testCases = parseTestCases(req.body);

        // Update problem
        const problem = await Problem.findOneAndUpdate(
            ownershipFilter(req, req.params.id),
            { title, description, inputFormat, outputFormat, sampleInput, sampleOutput, difficulty, testCases },
            { returnDocument: 'after', runValidators: true }
        );

        if (!problem) {
            req.flash('error', 'Problem not found or you do not have permission to update it.');
            return res.redirect('/problems/manage');
        }

        req.flash('success', 'Problem updated successfully!');
        res.redirect(`/problems/${problem._id}`);
    } catch (error) {
        console.error('Error updating problem:', error);
        req.flash('error', 'Failed to update problem');
        res.redirect(`/problems/${req.params.id}/edit`);
    }
};

/**
 * Delete problem - admin only
 */
exports.deleteProblem = async (req, res) => {
    try {
        const problem = await Problem.findOneAndDelete(ownershipFilter(req, req.params.id));

        if (!problem) {
            req.flash('error', 'Problem not found or you do not have permission to delete it.');
            return res.redirect('/problems/manage');
        }

        req.flash('success', `Problem "${problem.title}" deleted successfully!`);
        res.redirect('/problems/manage');
    } catch (error) {
        console.error('Error deleting problem:', error);
        req.flash('error', 'Failed to delete problem');
        res.redirect('/problems/manage');
    }
};

/**
 * Show problem management dashboard - admin only
 */
exports.manageProblem = async (req, res) => {
    try {
        const filter = req.user?.role === 'teacher' ? { createdBy: req.user._id } : {};
        // Fetch all problems with creation date
        const problems = await Problem.find(filter)
            .sort('-createdAt')
            .populate('createdBy', 'name');

        res.render("problems/manage", {
            title: "Manage Problems",
            problems
        });
    } catch (error) {
        console.error('Error loading management page:', error);
        req.flash('error', 'Failed to load problems');
        res.redirect('/problems');
    }
};

/**
 * Helper function: Parse test cases from form data
 * Form sends test cases as: testCases[0][input], testCases[0][expectedOutput], etc.
 */
function parseTestCases(body) {
    const raw = body?.testCases;

    const normalized = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object'
            ? Object.values(raw)
            : [];

    return normalized
        .map((testCase) => ({
            input: String(testCase?.input ?? ''),
            expectedOutput: String(testCase?.expectedOutput ?? ''),
        }))
        .filter((testCase) => testCase.input.trim() || testCase.expectedOutput.trim());
}
